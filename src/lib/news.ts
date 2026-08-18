/**
 * Player news aggregation (docs/BACKLOG.md §1).
 *
 * ## Shape of the thing
 *
 * News arrives keyed by *whatever the provider calls a player*, and this app
 * keys players three different ways depending on how the pool was seeded. So
 * every provider is normalised into a flat list of `NewsItem`s tagged with
 * `playerMatchKey(name, position)` — the same key §2's identity matcher already
 * uses — and the app looks headlines up by that.
 *
 * This file is deliberately **pure and network-free**. Everything that can
 * time out, rate-limit, or change shape without warning lives in
 * `src/server/news-service.ts`; everything here is a total function over data
 * you already have, which is what makes it testable at all.
 *
 * ## The rules this respects
 *
 * `PROJECT_PLAN.md` §4 keeps tiers and auction values off the board because
 * they are one source's opinion. Headlines are facts and fit that rule; a
 * provider's start/sit verdict does not. **Nothing here ranks a player or
 * suggests an action** — it sorts by recency, and that is the only judgement it
 * makes.
 */
import { playerMatchKey } from './sleeper'

export interface NewsItem {
  /** `playerMatchKey(name, position)`, or null for a story about nobody in particular. */
  key: string | null
  /** The player name as the provider wrote it — for display when unmatched. */
  playerName: string | null
  headline: string
  summary: string | null
  url: string | null
  /** Epoch millis. */
  published: number
  source: string
}

/** How much the market is moving on a player, from Sleeper's add/drop counts. */
export interface TrendingEntry {
  sleeperId: string
  direction: 'add' | 'drop'
  count: number
}

// ---------------------------------------------------------------------------
// ESPN
// ---------------------------------------------------------------------------

/** The slice of ESPN's news payload this actually depends on. */
export interface EspnNewsResponse {
  articles?: Array<{
    headline?: string | null
    description?: string | null
    published?: string | null
    links?: { web?: { href?: string | null } | null } | null
    categories?: Array<{
      type?: string | null
      description?: string | null
      athlete?: { id?: string | number | null; description?: string | null } | null
    }> | null
  }> | null
}

/**
 * Flatten ESPN's article list into one `NewsItem` per (article × player tagged).
 *
 * ESPN tags each story with the athletes it mentions, which is the whole reason
 * this provider is usable: one request returns ~50 articles covering ~130
 * players, so a pool of 500 is served without ever fetching per player. That
 * matters more than it looks — §1 bans per-request provider calls on draft
 * night, and a provider that only answered per-player would have needed a
 * pre-fetch job over the entire pool.
 *
 * ⚠️ **Position is not in the athlete tag**, so the key is built with a
 * wildcard position and matched loosely by `newsFor`. Names are unique enough
 * within a 500-player fantasy pool for this to be safe, and the alternative —
 * dropping every ESPN item because it lacks a position — throws away the feed.
 */
export function fromEspn(payload: EspnNewsResponse, now = Date.now()): NewsItem[] {
  const out: NewsItem[] = []
  for (const a of payload.articles ?? []) {
    const headline = a.headline?.trim()
    if (!headline) continue

    const published = a.published ? Date.parse(a.published) : NaN
    const item = {
      headline,
      summary: a.description?.trim() || null,
      url: a.links?.web?.href ?? null,
      // An unparseable date sorts as "now" rather than 1970, which would bury a
      // fresh story at the bottom of every list.
      published: Number.isFinite(published) ? published : now,
      source: 'ESPN',
    }

    const athletes = (a.categories ?? []).filter(
      (c) => c?.type === 'athlete' && c.athlete?.description,
    )
    if (athletes.length === 0) {
      out.push({ ...item, key: null, playerName: null })
      continue
    }
    for (const c of athletes) {
      const name = String(c.athlete!.description).trim()
      out.push({ ...item, key: nameOnlyKey(name), playerName: name })
    }
  }
  return out
}

/**
 * A name-only match key, for providers that do not tell us a position.
 *
 * Shares `playerMatchKey`'s normalisation — suffixes, apostrophes, periods,
 * hyphens — so "A.J. Brown" from one source and "AJ Brown" from another land in
 * the same bucket. The position half is dropped rather than guessed.
 */
export function nameOnlyKey(name: string): string {
  return playerMatchKey(name, '').replace(/\|$/, '')
}

// ---------------------------------------------------------------------------
// Sleeper trending
// ---------------------------------------------------------------------------

export function fromSleeperTrending(
  raw: Array<{ player_id?: string; count?: number }> | null | undefined,
  direction: 'add' | 'drop',
): TrendingEntry[] {
  return (raw ?? [])
    .filter((r) => r?.player_id && typeof r.count === 'number')
    .map((r) => ({ sleeperId: String(r.player_id), direction, count: Number(r.count) }))
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/**
 * Every story mentioning a player, newest first.
 *
 * Matched on the name-only key, because the providers that tag players by name
 * do not agree on position vocabulary and one of them omits position entirely.
 */
export function newsFor(items: NewsItem[], playerName: string, limit = 6): NewsItem[] {
  const key = nameOnlyKey(playerName)
  return items
    .filter((i) => i.key === key)
    .sort((a, b) => b.published - a.published)
    .slice(0, limit)
}

/**
 * Index the feed by player key once, for rendering a whole list.
 *
 * `newsFor` is a linear scan, which is fine for one drawer and quadratic if the
 * pool calls it per row. This is the version to reach for in a list.
 */
export function indexByPlayer(items: NewsItem[]): Map<string, NewsItem[]> {
  const map = new Map<string, NewsItem[]>()
  for (const i of items) {
    if (!i.key) continue
    const list = map.get(i.key)
    if (list) list.push(i)
    else map.set(i.key, [i])
  }
  for (const list of map.values()) list.sort((a, b) => b.published - a.published)
  return map
}
