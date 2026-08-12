import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  hashPin,
  isValidPinFormat,
  sessionSecret,
  signSession,
  verifyPin,
} from '@/lib/auth'
import { getSql } from '@/server/sql'
import { currentManagerId } from '@/server/session'

export const dynamic = 'force-dynamic'

const Body = z.object({
  managerId: z.number().int().positive(),
  pin: z.string(),
})

/** Who am I? Used on load to decide between the join screen and the draft. */
export async function GET() {
  const managerId = await currentManagerId()
  return NextResponse.json({ managerId }, { headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Claim a seat.
 *
 * First manager to claim a name sets its PIN; after that the PIN must match.
 * The claim is a conditional UPDATE so two people claiming the same seat at the
 * same moment can't both succeed.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: 'Bad request' }, { status: 400 })
  }
  const { managerId, pin } = parsed.data

  if (!isValidPinFormat(pin)) {
    return NextResponse.json({ ok: false, reason: 'PIN must be 4 digits' }, { status: 400 })
  }

  const sql = getSql()
  const [manager] = await sql`SELECT id, display_name, pin_hash FROM managers WHERE id = ${managerId}`
  if (!manager) {
    return NextResponse.json({ ok: false, reason: 'Unknown manager' }, { status: 404 })
  }

  if (manager.pin_hash === null) {
    // Unclaimed seat: set the PIN, but only if it's still unclaimed at write
    // time, so a simultaneous claim by someone else can't be overwritten.
    const hash = await hashPin(pin)
    const claimed = await sql`
      UPDATE managers SET pin_hash = ${hash}
      WHERE id = ${managerId} AND pin_hash IS NULL
      RETURNING id`
    if (claimed.length === 0) {
      return NextResponse.json(
        { ok: false, reason: 'That seat was just claimed by someone else' },
        { status: 409 },
      )
    }
  } else if (!(await verifyPin(pin, manager.pin_hash))) {
    return NextResponse.json({ ok: false, reason: 'Wrong PIN' }, { status: 401 })
  }

  const res = NextResponse.json(
    { ok: true, managerId, displayName: manager.display_name },
    { headers: { 'Cache-Control': 'no-store' } },
  )
  res.cookies.set(SESSION_COOKIE, signSession(managerId, sessionSecret()), SESSION_COOKIE_OPTIONS)
  return res
}

/** Sign out — mainly for testing and for handing a laptop to someone else. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 })
  return res
}
