import { NextRequest, NextResponse } from 'next/server'
import { getState, settleExpiredLots } from '@/server/draft-service'

/**
 * ⚠️ This GET has side effects: it settles expired lots (see draft-service.ts).
 *
 * If this response is ever cached, the draft freezes — every client sits on a
 * stale 204 and no lot ever settles. It presents as a UI bug, so both guards
 * below are load-bearing:
 *   - force-dynamic stops Next prerendering/caching the route
 *   - no-store stops the CDN and the browser doing the same
 *
 * Do not enable `cacheComponents` in next.config.ts; Next 16 removes the
 * `dynamic` export when it's on. See AGENTS.md.
 */
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  await settleExpiredLots()
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
