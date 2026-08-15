import { NextRequest, NextResponse } from 'next/server'
import { getState } from '@/server/draft-service'

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
  const state = await getState()

  // Cheap path: nothing has changed since the client's last poll.
  const since = req.nextUrl.searchParams.get('v')
  if (since && since === state.version) {
    return new NextResponse(null, {
      status: 204,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  return NextResponse.json(state, { headers: { 'Cache-Control': 'no-store' } })
}
