import { NextResponse } from 'next/server'
import { z } from 'zod'
import { currentManagerId } from '@/server/session'
import { oracleAdminSummary, setOracleEnabled } from '@/server/settings-service'
import { getSql } from '@/server/sql'

/**
 * The commissioner's control for Ask the Oracle: read the switch and the running cost,
 * flip the switch. Commissioner only, decided from the database against the signed
 * session — never from the request.
 *
 *   GET  /api/oracle-admin                  { enabled, last24h, allTime, topAskers24h, … }
 *   POST /api/oracle-admin { enabled }      flip it; returns the same summary
 */
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, private' }

async function commishId(): Promise<{ id: number } | { error: NextResponse }> {
  const id = await currentManagerId()
  if (id === null) {
    return { error: NextResponse.json({ ok: false, reason: 'Not signed in' }, { status: 401, headers: NO_STORE }) }
  }
  const [me] = await getSql()`SELECT is_commish FROM managers WHERE id = ${id}`
  if (!me?.is_commish) {
    return { error: NextResponse.json({ ok: false, reason: 'Commissioner only' }, { status: 403, headers: NO_STORE }) }
  }
  return { id }
}

export async function GET() {
  const who = await commishId()
  if ('error' in who) return who.error
  return NextResponse.json({ ok: true, ...(await oracleAdminSummary()) }, { headers: NO_STORE })
}

const Body = z.object({ enabled: z.boolean() })

export async function POST(req: Request) {
  const who = await commishId()
  if ('error' in who) return who.error
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: 'Bad request' }, { status: 400, headers: NO_STORE })
  }
  await setOracleEnabled(parsed.data.enabled, who.id)
  return NextResponse.json({ ok: true, ...(await oracleAdminSummary()) }, { headers: NO_STORE })
}
