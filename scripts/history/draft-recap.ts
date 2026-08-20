/**
 * Draft recaps — the story of an auction, in a few sentences.
 *
 * ## Why the prose is stored and not generated on request
 *
 * `/history/drafts` is a Server Component and a finished draft never changes,
 * so generating on render would mean paying a model call, and waiting on one,
 * to re-derive an identical paragraph forever. Worse, it would put a third
 * party in the request path of a page in an app whose first rule is that
 * nothing on a request path makes an outbound call.
 *
 * So a recap is written once, stored on `seasons.draft_recap`, and read back
 * as text. Re-running this script is how it changes — the same shape as every
 * other artifact here: produced deliberately, committed, reviewable in a diff.
 *
 * ## The model is never told a number it could get wrong
 *
 * `buildFacts()` computes everything from the database — prices, ranks,
 * placements, who won — and the model is asked only to choose which of those
 * facts to tell and how to say it. It is explicitly forbidden from adding any
 * figure that is not in the pack. That keeps a generated sentence as accurate
 * as the query behind it, and it is why the fact pack is dumped rather than
 * hidden: `--facts` prints exactly what the model was given.
 *
 *   npm run draft:recap -- 2024            # write one season
 *   npm run draft:recap -- --all           # every season with picks
 *   npm run draft:recap -- 2024 --facts    # print the fact pack, call nothing
 *   npm run draft:recap -- 2024 --dry-run  # generate, print, do not store
 *   npm run draft:recap -- --seed          # load the committed recaps, call nothing
 */
import 'dotenv/config'
import { readFileSync } from 'fs'
import { join } from 'path'
import { getSql } from '../../src/server/sql'
import { getArchivedSeason } from '../../src/server/archive-service'
import { valueVsResults } from '../../src/lib/draft-value'

const ROOT = join(import.meta.dirname, '..', '..')
const MODEL = 'claude-opus-5'

const args = process.argv.slice(2)
const factsOnly = args.includes('--facts')
const dryRun = args.includes('--dry-run')
const all = args.includes('--all')
const seed = args.includes('--seed')
const seasonArg = args.find((a) => /^\d{4}$/.test(a))

export interface RecapFacts {
  season: number
  city: string | null
  state: string | null
  buyIn: number | null
  picks: number
  spent: number
  dollarPicks: number
  priciest: Array<{ player: string; position: string; price: number; manager: string }>
  byPosition: Array<{ position: string; spent: number; share: number; top: string }>
  spendByManager: Array<{
    manager: string
    spent: number
    onTopPlayer: number
    topPlayer: string
    byPick40: number
  }>
  /**
   * How the picks actually turned out. Null for a season still being played —
   * there is no verdict on a draft until the games are done.
   */
  value: {
    steals: Array<{ player: string; slot: string; price: number; finished: string; points: number; manager: string }>
    busts: Array<{ player: string; slot: string; price: number; finished: string; points: number; manager: string }>
    bestDrafter: { manager: string; delta: number } | null
  } | null
  outcome: {
    champion: string | null
    runnerUp: string | null
    regularSeasonWinner: string | null
    /** What the eventual champion did in this room. */
    championSpend: { spent: number; topPlayer: string; topPrice: number } | null
  }
  overBudget: Array<{ manager: string; spent: number }>
  notes: string[]
}

export async function buildFacts(season: number): Promise<RecapFacts> {
  const sql = getSql()
  const archive = await getArchivedSeason(season)
  if (!archive) throw new Error(`no archived season ${season}`)

  const name = new Map(archive.managers.map((m) => [m.id, m.displayName]))
  const picks = archive.rosters
  const spent = picks.reduce((s, p) => s + p.price, 0)

  const [meta] = await sql`
    SELECT champion_manager_id, runner_up_manager_id, draft_city, draft_state, buy_in
    FROM seasons WHERE season = ${season}`
  const standings = await sql`
    SELECT manager_id, place FROM season_standings WHERE season = ${season} ORDER BY place`

  const byPrice = [...picks].sort((a, b) => b.price - a.price)
  const positions = ['QB', 'RB', 'WR', 'TE', 'DEF']
  const byPosition = positions
    .map((position) => {
      const group = picks.filter((p) => p.position === position)
      const total = group.reduce((s, p) => s + p.price, 0)
      const top = [...group].sort((a, b) => b.price - a.price)[0]
      return {
        position,
        spent: total,
        share: spent ? Math.round((total / spent) * 100) : 0,
        top: top ? `${top.name} $${top.price}` : '—',
      }
    })
    .filter((p) => p.spent > 0)

  const spendByManager = archive.managers.map((m) => {
    const mine = picks.filter((p) => p.managerId === m.id)
    const top = [...mine].sort((a, b) => b.price - a.price)[0]
    return {
      manager: m.displayName,
      spent: mine.reduce((s, p) => s + p.price, 0),
      onTopPlayer: top?.price ?? 0,
      topPlayer: top?.name ?? '—',
      byPick40: mine.filter((p) => p.pickNo <= 40).reduce((s, p) => s + p.price, 0),
    }
  })

  // What each pick was actually worth, from the season it bought. A season
  // still in progress gets null rather than a half-season verdict.
  const seasonPoints = new Map<string, number>(
    (
      await sql`SELECT player_id, total_points FROM player_seasons WHERE season = ${season}`
    ).map((r) => [String(r.player_id), Number(r.total_points)]),
  )
  const pointsById = await sql`
    SELECT id, player_sleeper_id FROM picks WHERE season = ${season}`
  const sleeperByPick = new Map(pointsById.map((r) => [Number(r.id), r.player_sleeper_id as string | null]))
  const report = picks.some((p) => sleeperByPick.get(p.id) && seasonPoints.has(sleeperByPick.get(p.id)!))
    ? valueVsResults(
        picks.map((p) => {
          const sid = sleeperByPick.get(p.id)
          return {
            pickId: p.id,
            name: p.name,
            position: p.position,
            price: p.price,
            managerId: p.managerId,
            points: sid ? (seasonPoints.get(sid) ?? null) : null,
          }
        }),
      )
    : null
  const shape = (v: NonNullable<typeof report>['steals'][number]) => ({
    player: v.name,
    slot: `${v.position}${v.priceRank} by price`,
    price: v.price,
    finished: `${v.position}${v.finishRank}`,
    points: Math.round(v.points),
    manager: name.get(v.managerId) ?? '?',
  })

  const championId = meta?.champion_manager_id ?? null
  const championPicks = championId ? picks.filter((p) => p.managerId === championId) : []
  const championTop = [...championPicks].sort((a, b) => b.price - a.price)[0]

  return {
    season,
    city: meta?.draft_city ?? null,
    state: meta?.draft_state ?? null,
    buyIn: meta?.buy_in === null || meta?.buy_in === undefined ? null : Number(meta.buy_in),
    picks: picks.length,
    spent,
    dollarPicks: picks.filter((p) => p.price === 1).length,
    priciest: byPrice.slice(0, 5).map((p) => ({
      player: p.name,
      position: p.position,
      price: p.price,
      manager: name.get(p.managerId) ?? '?',
    })),
    byPosition,
    spendByManager,
    value: report
      ? {
          steals: report.steals.map(shape),
          busts: report.busts.map(shape),
          bestDrafter: report.byManager[0]
            ? { manager: name.get(report.byManager[0].managerId) ?? '?', delta: report.byManager[0].delta }
            : null,
        }
      : null,
    outcome: {
      champion: championId ? (name.get(championId) ?? null) : null,
      runnerUp: meta?.runner_up_manager_id ? (name.get(meta.runner_up_manager_id) ?? null) : null,
      regularSeasonWinner: standings[0] ? (name.get(standings[0].manager_id) ?? null) : null,
      championSpend: championTop
        ? {
            spent: championPicks.reduce((s, p) => s + p.price, 0),
            topPlayer: championTop.name,
            topPrice: championTop.price,
          }
        : null,
    },
    overBudget: spendByManager
      .filter((m) => m.spent > archive.startingBudget)
      .map((m) => ({ manager: m.manager, spent: m.spent })),
    notes: archive.notes ?? [],
  }
}

const PROMPT = `You write the recap paragraph that sits under a fantasy football auction draft on a
league history page. Ten friends, one room, real money, budgets called aloud.

Write 2-4 sentences. House style is a good sports section: dry, specific, a little wry. Lead with
whatever is actually interesting about THIS draft — the run on one position, the person who spent
half their budget before pick 40, the $1 flier who finished top five, the big-money name who did
nothing, the champion and how they got there. Name people and numbers.

The value block is the payoff and usually the best material: it compares what a player COST
against where they actually FINISHED that season, within their own position. "slot" is where the
price ranked them; "finished" is where they ended up. A $1 receiver who finished WR4 is a steal; a
$47 back who finished RB44 is a bust. If value is null the season is not finished — say nothing
about how picks turned out.

Hard rules:
- Every figure must come from the fact pack. Do not add, round differently, or infer a number.
- Do not mention data corrections, missing records or import notes. Those are shown separately.
- No preamble, no heading, no quote marks around the output. Just the paragraph.
- Never open with "In 2024," or the year. Start with the story.
- If the champion is known, land it: what they did in this room and how it turned out.`

async function generate(facts: RecapFacts): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    console.error(
      '\n✗ ANTHROPIC_API_KEY is not set, so no recap can be generated.\n' +
        '  The fact pack is what the model would receive — print it with --facts.\n',
    )
    process.exit(1)
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(facts, null, 2) }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`)
  const body = (await res.json()) as { content: Array<{ type: string; text?: string }> }
  const text = body.content.find((c) => c.type === 'text')?.text?.trim()
  if (!text) throw new Error('no text in the model response')
  return text
}

async function main() {
  const sql = getSql()

  // --seed loads the committed paragraphs instead of generating. It is how a
  // rebuilt database gets its recaps back without an API key, and it keeps the
  // text under review in a diff rather than only in a column.
  if (seed) {
    const file = JSON.parse(
      readFileSync(join(ROOT, 'data', 'history', 'draft-recaps.json'), 'utf8'),
    ) as { model: string; recaps: Record<string, string> }
    for (const [season, recap] of Object.entries(file.recaps)) {
      const res = await sql`
        UPDATE seasons
        SET draft_recap = ${recap}, draft_recap_model = ${file.model}, draft_recap_at = now()
        WHERE season = ${Number(season)}
        RETURNING season`
      console.log(res.length ? `  ✓ ${season}` : `  · ${season} has no seasons row, skipped`)
    }
    return
  }
  const seasons = all
    ? (await sql`SELECT DISTINCT season FROM picks ORDER BY season DESC`).map((r) => Number(r.season))
    : [Number(seasonArg ?? (await sql`SELECT season FROM draft WHERE id = 1`)[0].season)]

  for (const season of seasons) {
    const facts = await buildFacts(season)
    if (factsOnly) {
      console.log(JSON.stringify(facts, null, 2))
      continue
    }
    const recap = await generate(facts)
    console.log(`\n─── ${season} ───\n${recap}\n`)
    if (dryRun) continue
    await sql`
      UPDATE seasons
      SET draft_recap = ${recap}, draft_recap_model = ${MODEL}, draft_recap_at = now()
      WHERE season = ${season}`
    console.log(`  ✓ stored on seasons.draft_recap`)
  }
}

if (process.argv[1]?.includes('draft-recap')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
