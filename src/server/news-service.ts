/**
 * Live headlines and market buzz (docs/BACKLOG.md §1, tiers 2 and 3).
 *
 * This is the only file in the feature that touches a third party, and it is
 * built around the assumption that the third party will eventually be down.
 *
 * ## The rules, and how each is kept
 *
 * 1. **News never touches `/api/state`.** It has its own route, `/api/news`,
 *    and nothing here is imported by `draft-service.ts` or `version.ts`.
 * 2. **Never fetch a provider from a request path on draft night.** Both
 *    providers answer for the *whole league* in a single request, so the cache
 *    below serves 500 players from one fetch every `TTL_MS`. A player nobody
 *    has requested is already covered.
 * 3. **A dead provider must be invisible, not fatal.** Every fetch is
 *    individually caught, has a hard timeout, and degrades to an empty list.
 *    A caller cannot tell the difference between "the provider is down" and
 *    "there is no news about this player", and neither can an auction —
 *    which is the point. Modelled on `autoSlot()`: display-only and
 *    deliberately unreachable from any award path.
 * 4. **News is not a ranking.** Headlines and trending counts are facts. No
 *    verdict, no projection, no start/sit.
 *
 * ## Tier 1 is not here
 *
 * "Is this guy hurt" is answered by `players.injury_status`, a stored column
 * refreshed by `npm run news:refresh`. That is deliberately *not* in this file:
 * the most important question must be answerable with no network at all.
 */
import { fromEspn, fromSleeperTrending, type NewsItem, type TrendingEntry } from '@/lib/news'

const ESPN_NEWS_URL =
  'https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=100'
const SLEEPER_TRENDING = (kind: 'add' | 'drop') =>
  `https://api.sleeper.app/v1/players/nfl/trending/${kind}?lookback_hours=24&limit=50`

/**
 * Five minutes.
 *
 * §1 allows "cache aggressively per-player with a TTL measured in minutes". The
 * feed itself moves on the order of hours, so this is well inside what the
 * providers expect, and on a ten-person league it means at most a handful of
 * upstream requests per hour no matter how many people open the drawer.
 */
const TTL_MS = 5 * 60 * 1000

/** Nothing upstream gets to hold a request open longer than this. */
const TIMEOUT_MS = 4000

export interface NewsSnapshot {
  items: NewsItem[]
  trending: TrendingEntry[]
  /** When this was fetched. Null means it has never succeeded. */
  fetchedAt: number | null
  /** Which providers answered. Surfaced so the UI can say so rather than imply freshness. */
  sources: string[]
  /** True when everything failed and this is an empty shell. */
  degraded: boolean
}

const EMPTY: NewsSnapshot = {
  items: [],
  trending: [],
  fetchedAt: null,
  sources: [],
  degraded: true,
}

/**
 * Process-wide cache.
 *
 * Vercel's Fluid Compute reuses instances across requests, so this survives
 * between calls in practice — and when it does not, the cost of a miss is one
 * upstream request, not a broken page. Deliberately not in Postgres: news is
 * disposable, and a table would need a migration, a cleanup story, and a reason
 * to trust it over simply asking again.
 */
let cache: NewsSnapshot | null = null
let inFlight: Promise<NewsSnapshot> | null = null

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    // Swallowed on purpose. A timeout, a DNS failure, a 500, or a body that is
    // suddenly HTML all mean the same thing to this feature: no news.
    return null
  }
}

async function refresh(): Promise<NewsSnapshot> {
  // Settled, not `all` — one provider failing must not take the other down.
  const [espnRaw, addRaw, dropRaw] = await Promise.all([
    getJson<Parameters<typeof fromEspn>[0]>(ESPN_NEWS_URL),
    getJson<Array<{ player_id?: string; count?: number }>>(SLEEPER_TRENDING('add')),
    getJson<Array<{ player_id?: string; count?: number }>>(SLEEPER_TRENDING('drop')),
  ])

  const items = espnRaw ? fromEspn(espnRaw) : []
  const trending = [
    ...fromSleeperTrending(addRaw, 'add'),
    ...fromSleeperTrending(dropRaw, 'drop'),
  ]

  const sources: string[] = []
  if (espnRaw) sources.push('ESPN')
  if (addRaw || dropRaw) sources.push('Sleeper')

  return {
    items,
    trending,
    fetchedAt: Date.now(),
    sources,
    degraded: sources.length === 0,
  }
}

/**
 * The current snapshot, refreshing at most once per TTL.
 *
 * ⚠️ **A failed refresh keeps the previous snapshot** rather than replacing it
 * with an empty one. Stale headlines are strictly better than none, and a
 * provider blipping for thirty seconds should not blank a panel that was fine a
 * moment ago. The staleness is reported, not hidden.
 *
 * Concurrent callers share one in-flight refresh, so ten clients opening the
 * drawer at once produce one upstream request rather than ten.
 */
export async function getNews(): Promise<NewsSnapshot> {
  const fresh = cache && cache.fetchedAt && Date.now() - cache.fetchedAt < TTL_MS
  if (fresh) return cache!
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const next = await refresh()
      // Keep what we had if this attempt got nothing and the old one had something.
      if (next.degraded && cache && cache.items.length > 0) {
        cache = { ...cache, degraded: true }
      } else {
        cache = next
      }
      return cache
    } catch {
      return cache ?? EMPTY
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

/** Test seam — drops the cache so a suite is not served a previous run's fetch. */
export function __resetNewsCache() {
  cache = null
  inFlight = null
}
