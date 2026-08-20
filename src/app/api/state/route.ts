import { NextRequest, NextResponse } from 'next/server'
import { getState, getVersion } from '@/server/draft-service'

/**
 * ⚠️ This response must never be cached.
 *
 * It no longer has side effects — there is no clock, so nothing settles on read
 * — but the whole draft is still driven by this poll. A cached 204 would leave
 * every client sitting on a stale board while the room carries on without them,
 * and it presents as a UI bug rather than a caching one. Both guards below are
 * load-bearing:
 *   - force-dynamic stops Next prerendering/caching the route
 *   - no-store stops the CDN and the browser doing the same
 *
 * Do not enable `cacheComponents` in next.config.ts; Next 16 removes the
 * `dynamic` export when it's on. See AGENTS.md.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const since = req.nextUrl.searchParams.get('v')

  // Cheap path: nothing has changed since the client's last poll, which is what
  // almost every poll is asking. One query to find that out, rather than the five
  // `getState()` runs to rebuild a state this branch then throws away — see
  // `getVersion()`, which is also why the order here is inverted from before.
  //
  // A client with no `v` is a first load and skips this: it needs the board
  // regardless, so asking for the version first would just add a round trip.
  if (since) {
    const current = await getVersion()
    if (current === since) {
      return new NextResponse(null, {
        status: 204,
        headers: { 'Cache-Control': 'no-store' },
      })
    }
  }

  // The version may have moved again between the check above and this read. That
  // is fine and needs no locking: the response carries whatever version it
  // actually reflects, so the client stays consistent with the body it got.
  const state = await getState()
  return NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } })
}
