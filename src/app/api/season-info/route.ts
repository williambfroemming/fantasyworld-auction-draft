import { NextResponse } from 'next/server'
import { getSeasonInfo } from '@/server/commish-service'

/**
 * Where this season's draft was held, and what it cost to enter.
 *
 * A separate route from `/api/state` on purpose. These three fields change
 * roughly once a year, while `/api/state` is polled every 400ms by ten clients
 * for four hours straight; there is no reason to carry them on that path. See
 * `setSeasonInfo` in `commish-service.ts`.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(await getSeasonInfo(), {
    headers: { 'Cache-Control': 'no-store' },
  })
}
