/**
 * First-party activity tracking: the pure half (docs/ACTIVITY_ROADMAP.md, step 64).
 *
 * Which pages league members use, by whom, and for how long. Commissioner-only:
 * the rows are read through `checkCommish()` and shown in `/admin`, never in
 * `/api/state`, never to the Oracle.
 *
 * Everything here is pure so the rules that make the numbers honest can be
 * tested without a DOM or a database:
 *
 *  - **Only visible, active time counts.** The clock runs while the tab is
 *    visible AND there has been input within `IDLE_MS`. A draft board left on
 *    a TV all night is not nine hours of use.
 *  - **The stored path is raw; the grouping is derived.** `pageGroup()` runs at
 *    read time, so a better grouping later rewrites no data. An unknown path is
 *    never dropped: it lands in its own "Other" row.
 */

/** No input for this long and the clock stops. */
export const IDLE_MS = 5 * 60_000
/** A segment shorter than this is a bounce or a flicker, and is not sent. */
export const MIN_SECONDS = 2
/** The server clamps to this, the column CHECK enforces it, and the clock flushes at it. */
export const MAX_SECONDS = 1800
export const MAX_PATH = 200

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * The pathname alone: no query string, no hash, no trailing slash, at most
 * `MAX_PATH` characters. Null for anything that is not a same-site path.
 *
 * The query string goes because it carries nothing worth keeping and sometimes
 * something worth not keeping (`/join?next=…`).
 */
export function normalisePath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let p = raw.split('#')[0].split('?')[0].trim()
  if (!p.startsWith('/') || p.startsWith('//')) return null
  if (/[\u0000-\u001f\s\\]/.test(p)) return null
  if (p.length > 1) p = p.replace(/\/+$/, '') || '/'
  return p.slice(0, MAX_PATH)
}

export interface PageGroup {
  key: string
  label: string
}

/**
 * Built from the real route tree (`find src/app -name page.tsx`). Ordered:
 * the first match wins, so a specific dynamic route sits before its index.
 * The labels follow the site menu (src/components/SiteNav.tsx).
 */
const PAGE_GROUPS: Array<{ key: string; label: string; test: RegExp }> = [
  { key: 'home', label: 'Front page', test: /^\/$/ },
  { key: 'draft', label: 'Draft Room', test: /^\/draft$/ },
  { key: 'board', label: 'Board', test: /^\/board$/ },
  { key: 'trades', label: 'Trades', test: /^\/trades$/ },
  { key: 'stats', label: 'Spend & Value', test: /^\/stats$/ },
  { key: 'glossary', label: 'Glossary', test: /^\/glossary$/ },
  // /setup only redirects to /admin now; a visit to it is a visit to the panel.
  { key: 'admin', label: 'Admin', test: /^\/(admin|setup)$/ },
  { key: 'history', label: 'League Summary', test: /^\/history$/ },
  { key: 'gazette-issue', label: 'Gazette issue', test: /^\/gazette\/[^/]+\/[^/]+$/ },
  { key: 'gazette', label: 'The Gazette', test: /^\/gazette$/ },
  { key: 'records', label: 'Records', test: /^\/history\/records$/ },
  { key: 'charts', label: 'Charts', test: /^\/history\/charts$/ },
  { key: 'ratings', label: 'Ratings', test: /^\/history\/ratings$/ },
  { key: 'waivers', label: 'Waivers', test: /^\/history\/waivers$/ },
  { key: 'member', label: 'Member page', test: /^\/history\/members\/[^/]+$/ },
  { key: 'members', label: 'Members', test: /^\/history\/members$/ },
  { key: 'player', label: 'Player page', test: /^\/history\/players\/[^/]+$/ },
  { key: 'players', label: 'Players', test: /^\/history\/players$/ },
  { key: 'h2h', label: 'Head to Head', test: /^\/history\/h2h$/ },
  { key: 'by-week', label: 'Record by Week', test: /^\/history\/by-week$/ },
  { key: 'oracle', label: 'Ask the Oracle', test: /^\/oracle$/ },
  { key: 'drafts', label: 'Past Auctions', test: /^\/history\/drafts$/ },
  { key: 'test', label: 'Test console', test: /^\/test$/ },
]

/** The page a path belongs to. Unknown paths keep their own row, never dropped. */
export function pageGroup(path: string): PageGroup {
  for (const g of PAGE_GROUPS) if (g.test.test(path)) return { key: g.key, label: g.label }
  return { key: `other:${path}`, label: `Other: ${path}` }
}

/** The tracker never runs here: a signed-out visitor has no manager to attribute. */
export function isUntrackedPath(path: string): boolean {
  return path === '/join' || path.startsWith('/join/')
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

export interface Segment {
  /** Epoch ms when this segment's counted time began. */
  startedAt: number
  activeSeconds: number
}

export interface ActivityClock {
  /** The tab became visible. Counts as interaction: coming back is not idling. */
  visible(now: number): void
  hidden(now: number): void
  /** Pointer, key, scroll or touch. */
  input(now: number): void
  /**
   * Call periodically. Returns a segment to send when the user has gone idle or
   * the segment has reached `MAX_SECONDS`, otherwise null.
   */
  tick(now: number): Segment | null
  /** End the segment now (navigation, hide, page exit). Null if it was too short. */
  flush(now: number): Segment | null
}

/**
 * The visible-and-active timer, as a state machine with the time passed in.
 *
 * Counted time runs from the moment the clock starts running to whichever comes
 * first: now, or `IDLE_MS` after the last input. So a tick that arrives late
 * never credits the idle stretch.
 */
export function createActivityClock(
  now: number,
  isVisible: boolean,
  opts: { idleMs?: number; minSeconds?: number; maxSeconds?: number } = {},
): ActivityClock {
  const idleMs = opts.idleMs ?? IDLE_MS
  const minSeconds = opts.minSeconds ?? MIN_SECONDS
  const maxSeconds = opts.maxSeconds ?? MAX_SECONDS

  let visible = isVisible
  let lastInput = now
  let runningSince: number | null = visible ? now : null
  let segStart: number | null = runningSince
  let acc = 0

  function settle(t: number) {
    if (runningSince === null) return
    const end = Math.min(t, lastInput + idleMs)
    if (end > runningSince) acc += end - runningSince
    runningSince = visible && t < lastInput + idleMs ? t : null
  }

  function start(t: number) {
    if (runningSince === null && visible) {
      runningSince = t
      if (segStart === null) segStart = t
    }
  }

  function flush(t: number): Segment | null {
    settle(t)
    const secs = Math.round(acc / 1000)
    const began = segStart
    acc = 0
    segStart = runningSince === null ? null : t
    if (began === null || secs < minSeconds) return null
    return { startedAt: began, activeSeconds: Math.min(secs, maxSeconds) }
  }

  return {
    visible(t) {
      settle(t)
      visible = true
      lastInput = t
      start(t)
    },
    hidden(t) {
      settle(t)
      visible = false
      runningSince = null
    },
    input(t) {
      settle(t)
      lastInput = t
      start(t)
    },
    tick(t) {
      settle(t)
      const idle = t >= lastInput + idleMs
      if ((idle && acc > 0) || acc >= maxSeconds * 1000) return flush(t)
      return null
    },
    flush,
  }
}

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------

export interface VisitRow {
  managerId: number
  path: string
  startedAt: Date | string
  activeSeconds: number
}

export interface ActivitySummary {
  totalSeconds: number
  visits: number
  byManager: Array<{ managerId: number; seconds: number; visits: number; lastSeen: string }>
  byPage: Array<{ key: string; label: string; seconds: number; visits: number; people: number }>
  /** Seconds per manager per page group. Only non-zero cells are listed. */
  matrix: Array<{ managerId: number; key: string; seconds: number }>
  /** Every day from the first visit to the last, zeros included, in `timeZone`. */
  byDay: Array<{ day: string; seconds: number }>
}

const dayKey = (d: Date, timeZone: string) =>
  // en-CA formats as YYYY-MM-DD.
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

/**
 * Totals for the admin view. `from` is inclusive and `to` exclusive, both on
 * `startedAt`; either may be null for "unbounded". `excludeIds` is how the
 * commissioner hides their own browsing.
 *
 * Days are bucketed in the league's time zone, Pacific by default: a visit at
 * 9pm on a Sunday belongs to Sunday, not to Monday in UTC.
 */
export function activitySummary(
  rows: VisitRow[],
  opts: { from?: Date | null; to?: Date | null; excludeIds?: number[]; timeZone?: string } = {},
): ActivitySummary {
  const tz = opts.timeZone ?? 'America/Los_Angeles'
  const exclude = new Set(opts.excludeIds ?? [])
  const from = opts.from?.getTime() ?? -Infinity
  const to = opts.to?.getTime() ?? Infinity

  const managers = new Map<number, { seconds: number; visits: number; last: number }>()
  const pages = new Map<string, { label: string; seconds: number; visits: number; people: Set<number> }>()
  const cells = new Map<string, { managerId: number; key: string; seconds: number }>()
  const days = new Map<string, number>()
  let totalSeconds = 0
  let visits = 0
  let first = Infinity
  let last = -Infinity

  for (const r of rows) {
    if (exclude.has(r.managerId)) continue
    const at = new Date(r.startedAt)
    const t = at.getTime()
    if (!(t >= from && t < to)) continue
    const secs = r.activeSeconds
    totalSeconds += secs
    visits += 1
    first = Math.min(first, t)
    last = Math.max(last, t)

    const m = managers.get(r.managerId) ?? { seconds: 0, visits: 0, last: -Infinity }
    m.seconds += secs
    m.visits += 1
    m.last = Math.max(m.last, t)
    managers.set(r.managerId, m)

    const g = pageGroup(r.path)
    const p = pages.get(g.key) ?? { label: g.label, seconds: 0, visits: 0, people: new Set<number>() }
    p.seconds += secs
    p.visits += 1
    p.people.add(r.managerId)
    pages.set(g.key, p)

    const ck = `${r.managerId}|${g.key}`
    const c = cells.get(ck) ?? { managerId: r.managerId, key: g.key, seconds: 0 }
    c.seconds += secs
    cells.set(ck, c)

    const dk = dayKey(at, tz)
    days.set(dk, (days.get(dk) ?? 0) + secs)
  }

  const byDay: ActivitySummary['byDay'] = []
  if (visits > 0) {
    // Walk noon to noon so a DST change can never skip or repeat a day.
    const end = dayKey(new Date(last), tz)
    let cursor = new Date(`${dayKey(new Date(first), tz)}T12:00:00Z`)
    for (let guard = 0; guard < 4000; guard++) {
      const dk = cursor.toISOString().slice(0, 10)
      byDay.push({ day: dk, seconds: days.get(dk) ?? 0 })
      if (dk >= end) break
      cursor = new Date(cursor.getTime() + 86_400_000)
    }
  }

  return {
    totalSeconds,
    visits,
    byManager: [...managers.entries()]
      .map(([managerId, m]) => ({
        managerId,
        seconds: m.seconds,
        visits: m.visits,
        lastSeen: new Date(m.last).toISOString(),
      }))
      .sort((a, b) => b.seconds - a.seconds || a.managerId - b.managerId),
    byPage: [...pages.entries()]
      .map(([key, p]) => ({ key, label: p.label, seconds: p.seconds, visits: p.visits, people: p.people.size }))
      .sort((a, b) => b.seconds - a.seconds || a.key.localeCompare(b.key)),
    matrix: [...cells.values()],
    byDay,
  }
}

/** "45s", "3m 20s", "2h 14m". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  if (s < 3600) {
    const m = Math.floor(s / 60)
    const r = s % 60
    return r ? `${m}m ${r}s` : `${m}m`
  }
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}h ${m}m`
}
