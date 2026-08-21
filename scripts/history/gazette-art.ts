/**
 * Art for a Gazette issue.
 *
 *   npm run gazette:art -- 2025 14           # one issue
 *   npm run gazette:art -- 2025              # every issue of a season that has none
 *   npm run gazette:art -- --all             # every issue on record that has none
 *   npm run gazette:art -- 2025 14 --dry-run # write the art direction, generate nothing
 *   npm run gazette:art -- 2025 14 --regenerate
 *   npm run gazette:art -- --models          # what the gateway will actually serve
 *
 * ## The article dictates the art
 *
 * There is no house style baked in here, deliberately. The subject, the mood and
 * the treatment all come from the issue itself: the same model that writes the
 * Gazette is handed the finished headline, deck and column and asked to art
 * direct it. A fixed style prompt would give every week the same picture with
 * different furniture; letting the writer choose means the art for a blowout and
 * the art for a one-point loss are not the same image twice.
 *
 * Two consequences worth knowing:
 *
 * - The art is **derived from the stored issue**, so it is grounded in the same
 *   fact pack the prose is, and re-running this never changes the article.
 * - This is a **separate command from `npm run gazette`** on purpose. Art is
 *   optional, it is the part most likely to need re-rolling, and an image
 *   provider being down must never block an issue from being written.
 *
 * ## Never on a request path
 *
 * The image is made once, here, and written to `public/gazette/`. The front page
 * reads a file (`src/server/gazette-art.ts`) and never calls a provider. This is
 * the same rule that keeps Sleeper off `/api/state` and that got the live news
 * feed deleted — see `docs/BACKLOG.md` §1.
 */
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { experimental_generateImage as generateImage, gateway, generateText } from 'ai'
import { getSql } from '../../src/server/sql'

/** The writer. Same model that writes the issues, so the voice matches. */
const DIRECTOR_MODEL = 'claude-opus-5'

/**
 * The image model. Overridable because gateway slugs move — run `--models` to
 * see what is actually being served before pinning a new one here.
 *
 * ⚠️ The gateway serves **two kinds** of model behind these slugs and they are
 * not called the same way. A true image model (`gpt-image-*`, `flux-*`,
 * `recraft-*`) takes `generateImage`. A multimodal *language* model that happens
 * to emit pictures (`gemini-*-image`) rejects that call outright — "is a
 * language model, not an image model" — and has to go through `generateText`
 * with the picture arriving in `result.files`. `imageFor()` below asks the
 * gateway which kind this is rather than guessing from the name, because the
 * names are no guide: `gemini-3.1-flash-image-preview` is a language model.
 *
 * ⚠️ The default is the one that runs on a **free-tier** gateway account, so
 * `npm run gazette:art` works without buying anything. It is also the weakest of
 * them: it ignores `aspectRatio` and returns a square, which the front page
 * crops to 16:9. With credits on the account, these are markedly better and do
 * honour the aspect ratio:
 *
 *     GAZETTE_IMAGE_MODEL=openai/gpt-image-1.5      npm run gazette:art -- 2025
 *     GAZETTE_IMAGE_MODEL=google/gemini-3-pro-image npm run gazette:art -- 2025
 */
const IMAGE_MODEL = process.env.GAZETTE_IMAGE_MODEL ?? 'prodia/flux-fast-schnell'

const OUT_DIR = join(process.cwd(), 'public', 'gazette')

const argv = process.argv.slice(2)
const has = (f: string) => argv.includes(f)
const dryRun = has('--dry-run')
const regenerate = has('--regenerate')
const all = has('--all')
const positional = argv.filter((a) => !a.startsWith('--')).map(Number)

interface Issue {
  season: number
  week: number
  headline: string
  deck: string
  columnText: string
  weekLabel: string
}

/**
 * What the art director is told.
 *
 * The constraints are few and each one earns its place:
 *
 * 1. **No identifiable people.** The Gazette writes about ten real, named men.
 *    A generated photograph of "Daniel" is a fabricated picture of somebody who
 *    actually exists, and it would be published under their name. Symbol,
 *    object, place and weather carry a sports story perfectly well.
 * 2. **No real team marks.** NFL logos and uniforms are trademarks, and a model
 *    asked for them produces mangled ones, which is worse than not asking.
 * 3. **No lettering.** Generated text comes out as gibberish, and the headline
 *    is already set in Playfair two inches away.
 * 4. **Legible on cream and on near-black.** The app ships both themes off one
 *    set of tokens; art that only works on one ground breaks half the site.
 */
function directorPrompt(issue: Issue): string {
  return `You are art directing one illustration for this week's edition of the FantasyWorld Gazette, the league paper you write.

Here is the issue you just filed.

HEADLINE: ${issue.headline}
DECK: ${issue.deck}
COLUMN:
${issue.columnText}

Write a single image-generation prompt for the artwork that runs with it.

The article dictates the art. Choose the subject, the medium and the mood from
what this specific piece is actually about — a collapse, a rout, a theft, a
lucky escape and a dead rubber should not look alike. Commit to one image.

Hard constraints:
- No people with identifiable faces. No portraits. The Gazette writes about real
  named men and must not publish invented pictures of them. Reach for objects,
  places, weather, empty rooms, equipment, aftermath.
- No real team logos, uniforms or league marks.
- No lettering, numerals, captions or signage of any kind in the image.
- It must read on BOTH a cream newsprint ground and a near-black one, so avoid
  compositions that depend on a white or a black background.
- Landscape, roughly 16:9.

Reply with ONLY the image prompt. No preamble, no quotes, no explanation. Two to
four sentences.`
}

/** One call to the writer, matching the pattern in `gazette.ts`. */
async function directArt(issue: Issue): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: DIRECTOR_MODEL,
      max_tokens: 400,
      messages: [{ role: 'user', content: directorPrompt(issue) }],
    }),
  })

  if (!res.ok) throw new Error(`art direction failed: ${res.status} ${await res.text()}`)

  const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
  const text = body.content?.find((c) => c.type === 'text')?.text?.trim()
  if (!text) throw new Error('the model returned no art direction')
  return text
}

/** Extension for what came back, so the file name tells the truth. */
function extensionFor(mediaType: string | undefined): string {
  if (mediaType?.includes('webp')) return 'webp'
  if (mediaType?.includes('jpeg') || mediaType?.includes('jpg')) return 'jpg'
  return 'png'
}

/** Any art already on disk for this issue, whatever its extension. */
function existingArt(season: number, week: number): string[] {
  if (!existsSync(OUT_DIR)) return []
  return readdirSync(OUT_DIR)
    .filter((f) => f.startsWith(`${season}-${week}.`))
    .map((f) => join(OUT_DIR, f))
}

interface Art {
  bytes: Uint8Array
  mediaType: string | undefined
}

/** Cached so a backfill of twenty issues asks the gateway once. */
let modelKind: 'image' | 'language' | null = null

async function kindOf(model: string): Promise<'image' | 'language'> {
  if (modelKind) return modelKind
  try {
    const { models } = await gateway.getAvailableModels()
    const found = models.find((m) => m.id === model)
    modelKind = found?.modelType === 'image' ? 'image' : 'language'
  } catch {
    // The listing is a convenience, not a dependency. Assume the common case.
    modelKind = 'image'
  }
  return modelKind
}

/**
 * One picture, by whichever call this model actually accepts.
 */
async function imageFor(prompt: string): Promise<Art> {
  const tags = { gateway: { tags: ['feature:gazette-art'] } }

  if ((await kindOf(IMAGE_MODEL)) === 'image') {
    const { image } = await generateImage({
      model: IMAGE_MODEL,
      prompt,
      aspectRatio: '16:9',
      providerOptions: tags,
    })
    return { bytes: image.uint8Array, mediaType: image.mediaType }
  }

  const res = await generateText({ model: IMAGE_MODEL, prompt, providerOptions: tags })
  const file = res.files.find((f) => f.mediaType?.startsWith('image/'))
  if (!file) throw new Error(`${IMAGE_MODEL} returned no image`)
  return { bytes: file.uint8Array, mediaType: file.mediaType }
}

async function makeArt(issue: Issue): Promise<void> {
  const label = `${issue.season} wk ${issue.week}`
  const already = existingArt(issue.season, issue.week)

  if (already.length > 0 && !regenerate && !dryRun) {
    console.log(`  · ${label} already has art — use --regenerate`)
    return
  }

  console.log(`\n  ${label} — ${issue.headline}`)
  const prompt = await directArt(issue)
  console.log(`    direction: ${prompt.replace(/\s+/g, ' ')}`)

  if (dryRun) return

  const image = await imageFor(prompt)

  mkdirSync(OUT_DIR, { recursive: true })
  // Drop older art for this issue first, or a regenerate that changes format
  // leaves two files and `issueArt()` serves whichever extension it checks
  // first — which would be the stale one.
  for (const old of already) unlinkSync(old)

  const file = join(OUT_DIR, `${issue.season}-${issue.week}.${extensionFor(image.mediaType)}`)
  writeFileSync(file, image.bytes)
  console.log(`    ✓ ${file.replace(process.cwd() + '/', '')}`)
}

async function listModels(): Promise<void> {
  const models = await gateway.getAvailableModels()
  const image = models.models.filter(
    (m) => m.modelType === 'image' || /image|imagen|flux|dall/i.test(m.id),
  )
  console.log('\nImage-capable models on this gateway:\n')
  for (const m of image) console.log(`  ${m.id}${m.name ? `  — ${m.name}` : ''}`)
  console.log(`\nCurrent: ${IMAGE_MODEL}  (override with GAZETTE_IMAGE_MODEL)\n`)
}

async function main(): Promise<void> {
  if (has('--models')) return listModels()

  const [season, week] = positional
  if (!all && !season) {
    console.error(
      'Usage: npm run gazette:art -- <season> [week]\n' +
        '       npm run gazette:art -- --all\n' +
        '       npm run gazette:art -- --models',
    )
    process.exit(1)
  }

  const sql = getSql()
  const rows = await sql`
    SELECT season, week, headline, deck, column_text, facts->>'weekLabel' AS week_label
      FROM week_issues
     WHERE (${season ?? null}::int IS NULL OR season = ${season ?? null})
       AND (${week ?? null}::int IS NULL OR week = ${week ?? null})
     ORDER BY season DESC, week DESC`

  const issues: Issue[] = rows.map((r) => ({
    season: Number(r.season),
    week: Number(r.week),
    headline: String(r.headline),
    deck: String(r.deck),
    columnText: String(r.column_text),
    weekLabel: String(r.week_label ?? `week ${r.week}`),
  }))

  if (issues.length === 0) {
    console.log('No issues matched. Write one first with `npm run gazette`.')
    return
  }

  console.log(
    `${dryRun ? 'Directing' : 'Illustrating'} ${issues.length} issue${issues.length === 1 ? '' : 's'}` +
      `${dryRun ? '' : ` with ${IMAGE_MODEL}`}`,
  )

  let made = 0
  for (const issue of issues) {
    try {
      await makeArt(issue)
      made++
    } catch (err) {
      // One bad issue must not abandon a backfill of twenty. The prose is
      // already published and unaffected; art is the optional half.
      console.error(`    ✗ ${issue.season} wk ${issue.week}: ${(err as Error).message}`)
    }
  }

  console.log(`\nDone — ${made}/${issues.length}.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
