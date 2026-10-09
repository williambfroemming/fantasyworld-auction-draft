/**
 * Every record a team has held after every week, and how often it got in.
 *
 * "Has anyone ever come back from 0-4?" is a question about history, and the
 * playoff odds cannot answer it: they are a model of *this* season. This is the
 * other half — after week N at W-L, how many teams were there, and how many
 * made the playoffs. It grows by a season's worth of cells every January with
 * nobody maintaining it, because it is derived from `season_matchups` and
 * `season_standings.made_playoffs`, never stored.
 *
 * ## Counts, not rates
 *
 * ⚠️ Six seasons put four teams in the 0-4 cell. "0 of 4" says how thin that is;
 * "0%" says it is a law. Every cell carries `teams` and `made` and nothing
 * here divides them — the caller does, and only above `MIN_SAMPLE`. A cell of
 * one or two teams is an anecdote and is drawn as one.
 *
 * ## What counts as history
 *
 *   - **Finished seasons only** — a champion on record. The season in progress
 *     is never history: its teams have not made or missed anything yet, and
 *     counting them as "missed" would drag every cell they touch toward zero.
 *   - **Weekly seasons only**, which is 2020 on. Earlier years have final
 *     standings and no week-by-week record, so they fall out by having no
 *     matchups rather than by a hardcoded year.
 *   - **Complete regular-season weeks**, via `completeWeeks()` — the same rows
 *     the season table and the odds count.
 *   - **A team that has tied stops contributing** from that week on. A 2-1-1
 *     record has no cell on a wins/losses grid, and folding a tie into either
 *     side would invent a result. Counted in `tiesExcluded` so it is visible.
 */
import { completeWeeks } from './season-so-far'
import type { HistoryMatchup, HistorySeason, HistoryStanding } from './history'

/** Below this many teams a cell is an anecdote, not a rate. */
export const MIN_SAMPLE = 3

export interface RecordCell {
  week: number
  wins: number
  losses: number
  /** Teams in finished seasons that held this record after this week. */
  teams: number
  /** Of those, how many made the playoffs. */
  made: number
  /** This season's managers sitting on this record right now. */
  current: number[]
}

export interface RecordPaths {
  /** Finished seasons counted, oldest first. Empty means no history at all. */
  seasons: number[]
  /** The longest regular season counted, so the grid has a row per week. */
  weeks: number
  cells: RecordCell[]
  /** The season whose teams are placed on the grid, or null out of season. */
  currentSeason: number | null
  /** The last complete week of that season. */
  currentWeek: number | null
  /** Team-weeks left out because the team had tied. */
  tiesExcluded: number
}

const key = (week: number, wins: number, losses: number) => `${week}:${wins}-${losses}`

/** Record after each complete week, per manager. Null from a tie onward. */
function paths(matchups: HistoryMatchup[], season: number) {
  const { complete } = completeWeeks(matchups, season)
  const out = new Map<number, Array<{ week: number; wins: number; losses: number } | null>>()
  const running = new Map<number, { wins: number; losses: number; tied: boolean }>()
  for (const [week, rows] of complete) {
    for (const r of rows) {
      const t = running.get(r.managerId) ?? { wins: 0, losses: 0, tied: false }
      if (r.result === 'W') t.wins++
      else if (r.result === 'L') t.losses++
      else t.tied = true
      running.set(r.managerId, t)
      const list = out.get(r.managerId) ?? []
      list.push(t.tied ? null : { week, wins: t.wins, losses: t.losses })
      out.set(r.managerId, list)
    }
  }
  return { complete, byManager: out }
}

export function recordPaths(input: {
  matchups: HistoryMatchup[]
  standings: HistoryStanding[]
  seasons: HistorySeason[]
  /** Placed on the grid and never counted as history. */
  currentSeason: number | null
}): RecordPaths {
  const { matchups, standings, currentSeason } = input
  const cells = new Map<string, RecordCell>()
  const cell = (week: number, wins: number, losses: number) => {
    const k = key(week, wins, losses)
    let c = cells.get(k)
    if (!c) {
      c = { week, wins, losses, teams: 0, made: 0, current: [] }
      cells.set(k, c)
    }
    return c
  }

  const finished = input.seasons
    .filter((s) => s.season !== currentSeason && s.championManagerId !== null)
    .map((s) => s.season)
    .sort((a, b) => a - b)

  const made = new Set(
    standings.filter((s) => s.madePlayoffs).map((s) => `${s.season}:${s.managerId}`),
  )

  const counted: number[] = []
  let weeks = 0
  let tiesExcluded = 0
  for (const season of finished) {
    const { complete, byManager } = paths(matchups, season)
    if (complete.length === 0) continue
    counted.push(season)
    weeks = Math.max(weeks, complete[complete.length - 1][0])
    for (const [managerId, list] of byManager) {
      const gotIn = made.has(`${season}:${managerId}`)
      for (const p of list) {
        if (p === null) {
          tiesExcluded++
          continue
        }
        const c = cell(p.week, p.wins, p.losses)
        c.teams++
        if (gotIn) c.made++
      }
    }
  }

  let currentWeek: number | null = null
  if (currentSeason !== null) {
    const { complete, byManager } = paths(matchups, currentSeason)
    if (complete.length) {
      currentWeek = complete[complete.length - 1][0]
      weeks = Math.max(weeks, currentWeek)
      for (const [managerId, list] of byManager) {
        const last = list[list.length - 1]
        if (last) cell(last.week, last.wins, last.losses).current.push(managerId)
      }
    }
  }

  return {
    seasons: counted,
    weeks,
    cells: [...cells.values()].sort((a, b) => a.week - b.week || b.wins - a.wins),
    currentSeason: currentWeek === null ? null : currentSeason,
    currentWeek,
    tiesExcluded,
  }
}

/** The cell for one record after one week, or undefined if nobody has held it. */
export function recordCell(paths: RecordPaths, week: number, wins: number, losses: number) {
  return paths.cells.find((c) => c.week === week && c.wins === wins && c.losses === losses)
}
