import { NextResponse } from 'next/server'
import { listMembers, listSeasonDetails } from '@/server/commish-service'
import { listJoinRequests } from '@/server/onboarding-service'
import { checkCommish } from '@/server/require-commish'

/**
 * What the admin panel needs that the polling payload must not carry.
 *
 *   GET /api/admin   { ok, members: AdminMember[], joinRequests: JoinRequest[], current, seasons: SeasonDetails[] }
 *
 * Commissioner only, decided from the database against the signed session.
 * ⚠️ Lock state and attempt counts stay here and never reach `/api/state` or the
 * fingerprint in src/lib/version.ts: they are not league-wide data, and the
 * polling path is the one thing in this app every client hits every 400ms.
 * `pin_hash` is never selected — `listMembers` reads only whether it is null, and
 * `listJoinRequests` leaves the requested PIN's hash behind.
 */
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, private' }

export async function GET() {
  const who = await checkCommish()
  if (!who.ok) {
    return NextResponse.json({ ok: false, reason: who.reason }, { status: who.status, headers: NO_STORE })
  }
  const [members, joinRequests, seasons] = await Promise.all([listMembers(), listJoinRequests(), listSeasonDetails()])
  return NextResponse.json({ ok: true, me: who.id, members, joinRequests, ...seasons }, { headers: NO_STORE })
}
