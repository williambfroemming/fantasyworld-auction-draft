/**
 * The FantasyWorld Gazette — write one week's edition.
 *
 *   npm run gazette                        # newest unwritten week of this season
 *   npm run gazette -- 2025 7              # one specific issue
 *   npm run gazette -- 2025 7 --facts      # print the pack, call nothing
 *   npm run gazette -- 2025 7 --dry-run    # generate, print, store nothing
 *   npm run gazette -- 2025 7 --regenerate # overwrite an existing issue
 *   npm run gazette -- 2025 7 --replay     # re-prompt from the STORED pack
 *   npm run gazette -- --sample 2025 6 3   # 3 consecutive weeks, dry-run
 *   npm run gazette -- --backfill 2025     # every played week of a season
 *   npm run gazette -- --backfill          # every played week, every season
 *   npm run gazette -- --preview 2026      # the season preview, from the auction
 *   npm run gazette -- --preview 2026 --facts
 *   npm run gazette -- --seed              # load committed issues, no API key
 *   npm run gazette -- --audit             # re-check every committed issue
 *
 * ## The season preview is week zero
 *
 * One edition a year has no games behind it: the one filed after the auction and
 * before week one. It is stored in the same table at week zero, which orders it
 * after last season's final and before this season's opener everywhere the
 * Gazette sorts itself, and it reads a completely different fact pack — see
 * `seasonPreview()` and `gazette-preview-prompt.ts`. It also picks the notebook
 * up across the New Year, from the last issue of the previous season.
 *
 * ## Why the prose is written here and not on a page
 *
 * The same reason `draft-recap.ts` exists: `/history/gazette` is a Server
 * Component, a finished week never changes, and this app's first rule is that
 * nothing on a request path makes an outbound call. An issue is written once,
 * stored, and read back as text.
 *
 * ## The issues are ordered, not independent
 *
 * Each edition reads the one before it — its threads for continuity, its belt
 * holder, the stat ids it already used. So a backfill runs **strictly
 * chronologically within a season**, and regenerating a mid-season week orphans
 * every later issue, which was written against a version of it that no longer
 * exists. `--regenerate` says so and takes `--forward` to redo the remainder.
 *
 * ## The grounding gate
 *
 * Nothing is stored until every figure in the prose is accounted for by the fact
 * pack. On a flag the model gets one chance to fix it with the offending numbers
 * named; a second failure stores nothing and exits non-zero. A hallucinated score
 * is fatal in a ten-person league where everyone already knows what happened.
 */
import 'dotenv/config'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getSql } from '../../src/server/sql'
import { getPreviewFacts, getWeekFacts } from '../../src/server/gazette-service'
import {
  misattributedNumbers,
  ungroundedNumbers,
  type GazetteFacts,
  type PreviewFacts,
  type Thread,
} from '../../src/lib/gazette'
import { PROMPT, PROMPT_VERSION } from './gazette-prompt'
import { PREVIEW_PROMPT, PREVIEW_PROMPT_VERSION } from './gazette-preview-prompt'

/**
 * Either pack. A week edition and the season preview share the grounding walk,
 * the notebook and the storage row, and share no figures at all.
 */
type Pack = GazetteFacts | PreviewFacts

const ROOT = join(import.meta.dirname, '..', '..')
const DATA_DIR = join(ROOT, 'data', 'history', 'gazette')
const MODEL = 'claude-opus-5'
const PAUSE_MS = 1000

const args = process.argv.slice(2).filter((a) => a !== '--')
const has = (f: string) => args.includes(f)
const nums = args.filter((a) => /^\d+$/.test(a)).map(Number)
const years = nums.filter((n) => n >= 2000)
const weeks = nums.filter((n) => n < 2000)

const factsOnly = has('--facts')
// A sample is always a dry run. Its whole purpose is to read three editions
// before committing to a voice, and storing them would seed the archive with the
// draft you were still deciding about.
const dryRun = has('--dry-run') || has('--sample')
const regenerate = has('--regenerate')
const forward = has('--forward')
const replay = has('--replay')
const seed = has('--seed')
const audit = has('--audit')
const backfill = has('--backfill')
const sample = has('--sample')
const preview = has('--preview')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Issue {
  issueTitle: string
  lens: string
  headline: string
  deck: string
  column: string
  gameNotes: string[]
  threads: Thread[]
}

// ---------------------------------------------------------------------------
// The model call
// ---------------------------------------------------------------------------

const SCHEMA = {
  type: 'object',
  properties: {
    issueTitle: { type: 'string' },
    lens: { type: 'string' },
    headline: { type: 'string' },
    deck: { type: 'string' },
    column: { type: 'string' },
    gameNotes: { type: 'array', items: { type: 'string' } },
    // The reporter's notebook. `kind` is required here even though it is
    // optional on the TypeScript type — the type has to parse issues written
    // before the notebook had sections, but everything written from now on
    // files itself properly.
    threads: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: ['bit', 'thesis', 'callback', 'arc'] },
          note: { type: 'string' },
        },
        required: ['id', 'kind', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['issueTitle', 'lens', 'headline', 'deck', 'column', 'gameNotes', 'threads'],
  additionalProperties: false,
}

function requireKey(): string {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    console.error(
      '\n✗ ANTHROPIC_API_KEY is not set, so no issue can be written.\n' +
        '  The fact pack is what the model would receive — print it with --facts.\n',
    )
    process.exit(1)
  }
  return key
}

/**
 * One call. Structured output rather than a prefill: an assistant prefill returns
 * a 400 on this model, and "please reply with JSON" is a request rather than a
 * guarantee.
 *
 * `max_tokens` caps thinking AND response text together, and adaptive thinking is
 * on by default here — hence the generous ceiling. This is the bug that sat
 * unnoticed in `draft-recap.ts`, which asked for 400.
 */
async function callModel(system: string, facts: Pack, repair?: string): Promise<Issue> {
  const key = requireKey()
  const messages: Array<{ role: string; content: string }> = [
    { role: 'user', content: JSON.stringify(facts, null, 2) },
  ]
  if (repair) messages.push({ role: 'user', content: repair })

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      // Caps thinking AND response text together. An edition is five fields and
      // a notebook, and a long one under a demanding frame has run past 8000 —
      // which arrives as a truncated JSON body rather than an error, so give it
      // room it will not normally use.
      max_tokens: 16000,
      system,
      output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
      messages,
    }),
  })
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`)
  const body = (await res.json()) as {
    stop_reason?: string
    content: Array<{ type: string; text?: string }>
  }
  if (body.stop_reason === 'refusal') throw new Error('the model declined to write this issue')
  const text = body.content.find((c) => c.type === 'text')?.text?.trim()
  if (!text) throw new Error('no text in the model response')

  try {
    return clean(JSON.parse(text) as Issue)
  } catch {
    // A truncated body is the likely cause and does not announce itself: the
    // JSON simply stops mid-string, and the parse error names a column number
    // rather than the actual problem. Say which it was.
    throw new Error(
      body.stop_reason === 'max_tokens'
        ? 'the edition ran past max_tokens and came back truncated'
        : `the model returned something that is not valid JSON (${text.length} chars)`,
    )
  }
}

/**
 * Strip inline HTML the model sometimes reaches for.
 *
 * The DECK is described to both prompts as "one italic standfirst sentence", and
 * a model will occasionally read "italic" as an instruction to mark it up and
 * return the sentence wrapped in an em tag. Every consumer renders these fields
 * as text — React escapes them — so the markup reaches the page as visible angle
 * brackets in the one line of an issue set in the largest italic type.
 *
 * Fixed here rather than in the prompt on purpose: this is a property of models
 * in general rather than of one set of instructions, a prompt edit would oblige
 * a version bump and a regeneration of work that is otherwise correct, and an
 * instruction is a request where a strip is a guarantee. A conservative tag list
 * rather than a general tag-stripper, so prose that legitimately contains an
 * angle bracket survives.
 */
const stripMarkup = (s: string) =>
  s.replace(/<\/?(?:em|i|b|strong|p|br|span|h[1-6])\s*\/?>/gi, '').trim()

const clean = (i: Issue): Issue => ({
  ...i,
  issueTitle: stripMarkup(i.issueTitle),
  lens: stripMarkup(i.lens),
  headline: stripMarkup(i.headline),
  deck: stripMarkup(i.deck),
  column: stripMarkup(i.column),
  gameNotes: i.gameNotes.map(stripMarkup),
})

/** Everything the grounding check should read: the prose, and only the prose. */
const proseOf = (i: Issue) => [i.headline, i.deck, i.column, ...i.gameNotes].join('\n\n')

/**
 * Generate, check, and give the model exactly one chance to fix its own numbers.
 *
 * One retry rather than a loop: a second failure on the same pack is a prompt
 * problem, and burning tokens on a third attempt hides that rather than fixing it.
 */
async function write(system: string, facts: Pack): Promise<Issue> {
  let issue = await callModel(system, facts)
  let flags = ungroundedNumbers(proseOf(issue), facts)

  if (flags.length) {
    console.log(`  · ${flags.length} figure(s) not in the pack — asking for a rewrite`)
    for (const f of flags) console.log(`      ${f}`)
    // ⚠️ The repair has to restate what the edition is FOR, not just what is
    // wrong with it. A message that says only "fix these numbers" gets an
    // edition optimised for grounding: the model retreats to a safe
    // manager-by-manager recital, every figure checks out, and the piece is
    // worse than the draft that failed. Week 11 of 2025 was written this way
    // and read like a stat block.
    issue = await callModel(
      system,
      facts,
      'These figures in your draft do not appear in the fact pack:\n' +
        flags.map((f) => `  ${f}`).join('\n') +
        '\nRewrite the edition using only figures from the pack, and do not compute totals.\n' +
        'Everything else about the brief still stands. This is a rewrite, not a retreat: keep the ' +
        'week to one thesis, keep the weighting uneven, keep the genre lens running, and do not ' +
        'fall back on a paragraph per manager. Losing the argument to save the arithmetic is a ' +
        'worse edition than the one you just filed.',
    )
    flags = ungroundedNumbers(proseOf(issue), facts)
    if (flags.length) {
      throw new Error(
        `still ungrounded after a rewrite:\n${flags.map((f) => `  ${f}`).join('\n')}`,
      )
    }
  }

  const wrong = misattributedNumbers(proseOf(issue), facts)
  if (wrong.length) {
    // Warn only. This false-positives on "M1 lost to M2's 148.62", which is a
    // perfectly good sentence -- so it is for a human to read, never a gate.
    console.log('  ⚠ possible misattribution, worth a read:')
    for (const w of wrong) console.log(`      ${w}`)
  }
  return issue
}

// ---------------------------------------------------------------------------
// The committed mirror
// ---------------------------------------------------------------------------

interface MirrorFile {
  _comment: string[]
  season: number
  issues: Record<string, Record<string, unknown>>
}

const mirrorPath = (season: number) => join(DATA_DIR, `${season}.json`)

function readMirror(season: number): MirrorFile {
  const path = mirrorPath(season)
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as MirrorFile
  return {
    _comment: [
      'The FantasyWorld Gazette. One file per season, one entry per played week.',
      'Committed as well as stored in Postgres so the prose is reviewable in a diff',
      'and survives a database rebuild -- the same reason every other source here is',
      'a file.',
      '',
      'facts is the exact pack the model was given, snapshotted at press time. Every',
      'table on the page renders from it, and gazette.test.ts asserts that every',
      'figure in the prose below appears in the pack beside it.',
      '',
      '  npm run gazette -- 2025 7 --facts   print the pack, call nothing',
      '  npm run gazette -- 2025 7 --replay  re-prompt from the stored pack',
      '  npm run gazette -- --seed           load this file into Postgres, no API key',
    ],
    season,
    issues: {},
  }
}

function writeMirror(
  season: number,
  week: number,
  issue: Issue,
  facts: Pack,
  promptVersion: number,
) {
  mkdirSync(DATA_DIR, { recursive: true })
  const file = readMirror(season)
  file.issues[String(week).padStart(2, '0')] = {
    week,
    headline: issue.headline,
    issueTitle: issue.issueTitle,
    lens: issue.lens,
    deck: issue.deck,
    column: issue.column,
    gameNotes: issue.gameNotes,
    threads: issue.threads,
    promptVersion,
    model: MODEL,
    generatedAt: new Date().toISOString(),
    facts,
  }
  const ordered = Object.fromEntries(Object.entries(file.issues).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(mirrorPath(season), `${JSON.stringify({ ...file, issues: ordered }, null, 2)}\n`)
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Is this week actually finished?
 *
 * `hasBeenPlayed()` in the importer is satisfied by a single Sunday score, so
 * `max(week)` alone would happily let a Thursday run write about a half-played
 * week. Every manager needs a lineup row and every game needs both sides.
 */
async function weekIsComplete(season: number, week: number): Promise<boolean> {
  const sql = getSql()
  const [{ managers }] = await sql`SELECT count(*)::int AS managers FROM managers`
  const [{ lineups }] = await sql`
    SELECT count(*)::int AS lineups FROM season_lineups WHERE season = ${season} AND week = ${week}`
  const [{ unpaired }] = await sql`
    SELECT count(*)::int AS unpaired FROM season_matchups
     WHERE season = ${season} AND week = ${week} AND opponent_manager_id IS NULL`
  return Number(lineups) >= Number(managers) && Number(unpaired) === 0
}

async function playedWeeks(season: number): Promise<number[]> {
  const sql = getSql()
  const rows = await sql`
    SELECT DISTINCT week FROM season_matchups WHERE season = ${season} ORDER BY week`
  return rows.map((r) => Number(r.week))
}

async function alreadyWritten(season: number, week: number): Promise<boolean> {
  const sql = getSql()
  const rows = await sql`SELECT 1 FROM week_issues WHERE season = ${season} AND week = ${week}`
  return rows.length > 0
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

async function store(
  season: number,
  week: number,
  issue: Issue,
  facts: Pack,
  promptVersion: number,
) {
  const sql = getSql()
  await sql`
    INSERT INTO week_issues (season, week, headline, issue_title, lens, deck, column_text, game_notes,
                             threads, facts, model, prompt_version, generated_at)
    VALUES (${season}, ${week}, ${issue.headline}, ${issue.issueTitle}, ${issue.lens}, ${issue.deck}, ${issue.column},
            ${JSON.stringify(issue.gameNotes)}::jsonb, ${JSON.stringify(issue.threads)}::jsonb,
            ${JSON.stringify(facts)}::jsonb, ${MODEL}, ${promptVersion}, now())
    ON CONFLICT (season, week) DO UPDATE
      SET headline = excluded.headline, issue_title = excluded.issue_title,
          lens = excluded.lens, deck = excluded.deck,
          column_text = excluded.column_text, game_notes = excluded.game_notes,
          threads = excluded.threads, facts = excluded.facts,
          model = excluded.model, prompt_version = excluded.prompt_version,
          generated_at = now()`
  writeMirror(season, week, issue, facts, promptVersion)
}

function show(season: number, week: number, issue: Issue, facts: Pack) {
  console.log(`\n${'─'.repeat(72)}`)
  console.log(`${facts.weekLabel} · ${season} — "${issue.issueTitle}"  [${issue.lens}]`)
  console.log(`\n${issue.headline.toUpperCase()}`)
  console.log(`${issue.deck}\n`)
  console.log(issue.column)
  console.log('')
  for (const note of issue.gameNotes) console.log(`  • ${note}`)
  if (issue.threads.length) {
    console.log("\n  Applewhite's notebook:")
    for (const t of issue.threads) {
      console.log(`    [${(t.kind ?? 'bit').padEnd(8)}] ${t.id}: ${t.note}`)
    }
  }
  console.log(`${'─'.repeat(72)}\n`)
}

// ---------------------------------------------------------------------------
// One issue
// ---------------------------------------------------------------------------

/**
 * Issues generated earlier in this run but not stored.
 *
 * Only `--sample` uses it. Continuity normally comes from the database, but a
 * sample stores nothing — so without this, week seven of a three-week sample
 * would be handed empty threads and the run could not show the one thing it
 * exists to show.
 */
interface Carried {
  headline: string
  column: string
  threads: Thread[]
}

async function one(
  season: number,
  week: number,
  carried?: Carried[],
): Promise<'written' | 'skipped' | 'failed'> {
  // The already-written guard exists to stop a backfill re-billing work it has
  // done. It has no business blocking anything that writes nothing: `--facts`
  // prints the pack, and `--sample` generates and throws the result away. Both
  // are exactly what you reach for when an issue that already exists reads
  // wrong, so refusing them there gets the guard precisely backwards.
  if (!factsOnly && !dryRun && !regenerate && !replay && (await alreadyWritten(season, week))) {
    console.log(`  · ${season} wk ${week} already written — use --regenerate`)
    return 'skipped'
  }

  let facts: GazetteFacts | null
  if (replay) {
    const sql = getSql()
    const rows = await sql`SELECT facts FROM week_issues WHERE season = ${season} AND week = ${week}`
    facts = (rows[0]?.facts as GazetteFacts | undefined) ?? null
    if (!facts) {
      console.log(`  · ${season} wk ${week} has no stored pack to replay`)
      return 'skipped'
    }
  } else {
    facts = await getWeekFacts(season, week)
  }

  if (!facts) {
    console.log(`  · ${season} wk ${week} has no games — nothing to write`)
    return 'skipped'
  }

  if (factsOnly) {
    console.log(JSON.stringify(facts, null, 2))
    return 'skipped'
  }

  if (!replay && !(await weekIsComplete(season, week))) {
    if (!regenerate) {
      console.log(`  · ${season} wk ${week} is not finished yet — use --regenerate to force`)
      return 'skipped'
    }
    console.log(`  ⚠ ${season} wk ${week} looks unfinished, writing anyway`)
  }

  if (carried?.length) {
    facts.priorThreads = carried[carried.length - 1].threads
    facts.priorColumns = carried.slice(-2).map((c) => c.column)
    facts.priorHeadlines = carried.slice(-4).map((c) => c.headline)
  }

  try {
    const issue = await write(PROMPT, facts)
    show(season, week, issue, facts)
    carried?.push({ headline: issue.headline, column: issue.column, threads: issue.threads })
    if (dryRun) return 'skipped'
    await store(season, week, issue, facts, PROMPT_VERSION)
    console.log(`  ✓ ${season} wk ${week} stored`)
    return 'written'
  } catch (err) {
    console.error(`  ✗ ${season} wk ${week}: ${err instanceof Error ? err.message : err}`)
    return 'failed'
  }
}

// ---------------------------------------------------------------------------
// The season preview
// ---------------------------------------------------------------------------

/**
 * Is the auction actually over?
 *
 * Every seat full, not merely "some picks exist" — a preview written halfway
 * through a draft would report rosters nobody has finished building, and unlike
 * a week issue it would be wrong about the one thing it is for. This is the
 * preview's `weekIsComplete`.
 */
async function draftIsComplete(season: number): Promise<boolean> {
  const sql = getSql()
  const [row] = await sql`
    SELECT (SELECT count(*)::int FROM managers) AS seats,
           (SELECT count(*)::int FROM picks WHERE season = ${season}) AS picks,
           COALESCE((SELECT roster_size FROM seasons WHERE season = ${season}),
                    (SELECT roster_size FROM draft WHERE id = 1)) AS roster_size`
  const wanted = Number(row.seats) * Number(row.roster_size)
  return wanted > 0 && Number(row.picks) >= wanted
}

/**
 * Write the season preview — week zero, filed from the auction.
 *
 * Stored in the same table and the same mirror as every other edition, at week
 * zero, which is what puts it after last season's final and before week one
 * everywhere the Gazette orders itself.
 */
async function onePreview(season: number): Promise<'written' | 'skipped' | 'failed'> {
  if (!factsOnly && !dryRun && !regenerate && !replay && (await alreadyWritten(season, 0))) {
    console.log(`  · the ${season} preview is already written — use --regenerate`)
    return 'skipped'
  }

  let facts: PreviewFacts | null
  if (replay) {
    const sql = getSql()
    const rows = await sql`SELECT facts FROM week_issues WHERE season = ${season} AND week = 0`
    facts = (rows[0]?.facts as PreviewFacts | undefined) ?? null
    if (!facts) {
      console.log(`  · the ${season} preview has no stored pack to replay`)
      return 'skipped'
    }
  } else {
    facts = await getPreviewFacts(season)
  }

  if (!facts) {
    console.log(`  · ${season} has no picks — there is no auction to preview`)
    return 'skipped'
  }

  if (factsOnly) {
    console.log(JSON.stringify(facts, null, 2))
    return 'skipped'
  }

  if (!replay && !(await draftIsComplete(season))) {
    if (!regenerate) {
      console.log(`  · the ${season} auction is not finished — use --regenerate to force`)
      return 'skipped'
    }
    console.log(`  ⚠ the ${season} auction looks unfinished, writing anyway`)
  }

  try {
    const issue = await write(PREVIEW_PROMPT, facts)
    show(season, 0, issue, facts)
    if (dryRun) return 'skipped'
    await store(season, 0, issue, facts, PREVIEW_PROMPT_VERSION)
    console.log(`  ✓ the ${season} preview stored`)
    return 'written'
  } catch (err) {
    console.error(`  ✗ ${season} preview: ${err instanceof Error ? err.message : err}`)
    return 'failed'
  }
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

/** Load the committed issues into Postgres. No API key, no model call. */
async function runSeed() {
  if (!existsSync(DATA_DIR)) {
    console.log('\n· No committed issues yet.\n')
    return
  }
  const sql = getSql()
  let n = 0
  for (const file of readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).sort()) {
    const parsed = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as MirrorFile
    for (const entry of Object.values(parsed.issues)) {
      const e = entry as Record<string, never>
      await sql`
        INSERT INTO week_issues (season, week, headline, issue_title, lens, deck, column_text, game_notes,
                                 threads, facts, model, prompt_version, generated_at)
        VALUES (${parsed.season}, ${e.week}, ${e.headline}, ${e.issueTitle}, ${e.lens}, ${e.deck}, ${e.column},
                ${JSON.stringify(e.gameNotes)}::jsonb, ${JSON.stringify(e.threads)}::jsonb,
                ${JSON.stringify(e.facts)}::jsonb, ${e.model}, ${e.promptVersion},
                ${e.generatedAt})
        ON CONFLICT (season, week) DO UPDATE
          SET headline = excluded.headline, issue_title = excluded.issue_title,
          lens = excluded.lens, deck = excluded.deck,
              column_text = excluded.column_text, game_notes = excluded.game_notes,
              threads = excluded.threads, facts = excluded.facts`
      n++
    }
  }
  console.log(`\n✓ ${n} issue${n === 1 ? '' : 's'} loaded from data/history/gazette.\n`)
}

/** Re-check every committed issue against its own snapshotted pack. */
function runAudit() {
  if (!existsSync(DATA_DIR)) {
    console.log('\n· No committed issues to audit.\n')
    return
  }
  let checked = 0
  let bad = 0
  for (const file of readdirSync(DATA_DIR).filter((f) => f.endsWith('.json')).sort()) {
    const parsed = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as MirrorFile
    for (const entry of Object.values(parsed.issues)) {
      const e = entry as Record<string, never>
      const prose = [e.headline, e.deck, e.column, ...(e.gameNotes as unknown as string[])].join('\n')
      const flags = ungroundedNumbers(prose, e.facts as unknown as GazetteFacts)
      checked++
      if (flags.length) {
        bad++
        console.log(`✗ ${parsed.season} wk ${e.week}`)
        for (const f of flags) console.log(`    ${f}`)
      }
    }
  }
  console.log(
    bad === 0
      ? `\n✓ ${checked} issue${checked === 1 ? '' : 's'} checked, every figure grounded.\n`
      : `\n✗ ${bad} of ${checked} issues quote a figure not in their own pack.\n`,
  )
  if (bad > 0) process.exit(1)
}

async function currentSeason(): Promise<number> {
  const sql = getSql()
  const [row] = await sql`SELECT season FROM draft WHERE id = 1`
  return Number(row.season)
}

async function main() {
  const sql = getSql()
  const [{ current_database: dbName }] = await sql`SELECT current_database()`
  console.log(`\nThe FantasyWorld Gazette · "${dbName}"\n`)

  if (seed) return runSeed()
  if (audit) return runAudit()

  // --- the season preview, week zero ---------------------------------------
  if (preview) {
    const season = years[0] ?? (await currentSeason())
    const result = await onePreview(season)
    if (result === 'failed') process.exit(1)
    return
  }

  // --- a consecutive sample, for tuning the voice -------------------------
  if (sample) {
    const season = years[0] ?? (await currentSeason())
    const from = weeks[0] ?? 1
    const count = weeks[1] ?? 3
    console.log(`Sampling ${count} consecutive weeks of ${season} from week ${from}. Nothing is stored.\n`)
    // Consecutive, and threaded in memory, so the run shows whether week two
    // actually picks up what week one put down.
    const carried: Carried[] = []
    for (let w = from; w < from + count; w++) {
      await one(season, w, carried)
      await sleep(PAUSE_MS)
    }
    return
  }

  // --- backfill ------------------------------------------------------------
  if (backfill) {
    const seasons = years.length
      ? years
      : (await sql`SELECT DISTINCT season FROM season_matchups ORDER BY season`).map((r) =>
          Number(r.season),
        )
    let written = 0
    let failed = 0
    for (const season of seasons) {
      // Strictly chronological: every issue reads the one before it.
      for (const w of await playedWeeks(season)) {
        const result = await one(season, w)
        if (result === 'written') written++
        if (result === 'failed') failed++
        if (result !== 'skipped') await sleep(PAUSE_MS)
      }
    }
    console.log(`\n✓ ${written} written, ${failed} failed.\n`)
    if (failed > 0) process.exit(1)
    return
  }

  // --- one issue -----------------------------------------------------------
  const season = years[0] ?? (await currentSeason())
  let week = weeks[0]
  if (week === undefined) {
    const [row] = await sql`SELECT max(week)::int AS week FROM season_matchups WHERE season = ${season}`
    if (row?.week === null || row?.week === undefined) {
      // The cron fires 52 weeks a year. Out of season this is a no-op, not a
      // failure -- a red workflow every week is a workflow nobody reads.
      console.log(`· ${season} has no played weeks yet — nothing to write.\n`)
      return
    }
    week = Number(row.week)
  }

  if (regenerate && !forward) {
    console.log(
      '  ⚠ Regenerating one week orphans every later issue of that season, which was\n' +
        '    written against a version of it that no longer exists. Pass --forward to\n' +
        '    redo the rest of the season too.\n',
    )
  }

  const result = await one(season, week)
  if (result === 'failed') process.exit(1)

  if (regenerate && forward) {
    for (const w of (await playedWeeks(season)).filter((w) => w > week!)) {
      await sleep(PAUSE_MS)
      await one(season, w)
    }
  }
}

if (process.argv[1]?.includes('gazette')) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
