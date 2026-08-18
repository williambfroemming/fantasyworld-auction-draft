import { NextResponse } from 'next/server'
import { newsFor } from '@/lib/news'
import { getNews } from '@/server/news-service'

/**
 * Headlines for one player (docs/BACKLOG.md §1).
 *
 *   GET /api/news?player=Puka%20Nacua
 *
 * ## Its own route, on purpose
 *
 * §1's first rule is that news never touches `/api/state`. That route is polled
 * by every client several times a second; putting a third party's uptime in
 * front of it would mean an ESPN outage could stall an award. This route can be
 * slow, can fail, and can return nothing, and the auction does not notice.
 *
 * It is also **not** in the polling fingerprint (`src/lib/version.ts`), so news
 * arriving never wakes ten clients — the same rule the private queue follows.
 *
 * ## Always 200
 *
 * A dead provider returns `{ ok: true, items: [] }` with `degraded: true`, not
 * an error status. §1: "a timeout shows an empty news panel and the auction
 * continues." A 5xx here would light up an error state in the UI for something
 * that is, from the room's point of view, simply "no news about this guy".
 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const player = new URL(req.url).searchParams.get('player')?.trim()
  if (!player) {
    return NextResponse.json({ ok: false, reason: 'Missing player' }, { status: 400 })
  }

  const snapshot = await getNews()

  return NextResponse.json(
    {
      ok: true,
      items: newsFor(snapshot.items, player),
      sources: snapshot.sources,
      fetchedAt: snapshot.fetchedAt,
      degraded: snapshot.degraded,
    },
    {
      headers: {
        // Short and shared: the upstream snapshot is league-wide, so one
        // manager's fetch warming the CDN for the rest is a feature. Well
        // inside the service's own 5-minute TTL.
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=240',
      },
    },
  )
}
