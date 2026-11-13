import { NextResponse } from 'next/server'
import { z } from 'zod'
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS, sessionSecret, signSession } from '@/lib/auth'
import { redeemPinReset, signIn } from '@/server/pin-service'
import { getSql } from '@/server/sql'
import { currentManagerId } from '@/server/session'

export const dynamic = 'force-dynamic'

// Sign in to a seat, OR use a commissioner's one-time link to choose a new PIN. The
// link rides on this route rather than a new one so the public allow-list in
// src/lib/gate.ts does not grow for it.
const Body = z.union([
  z.object({ managerId: z.number().int().positive(), pin: z.string() }),
  z.object({ resetToken: z.string().max(100), pin: z.string() }),
])

/**
 * Who am I? Read by the account menu in every page header, and on load to decide between
 * the join screen and the draft. `displayName` and `isCommish` are null when signed out.
 * Public, like the rest of this route, so it must say nothing about anyone but the caller.
 */
export async function GET() {
  const managerId = await currentManagerId()
  let displayName: string | null = null
  let isCommish: boolean | null = null
  if (managerId !== null) {
    const [m] = await getSql()`SELECT display_name, is_commish FROM managers WHERE id = ${managerId}`
    // A valid cookie for a seat that no longer exists reads as signed out.
    displayName = (m?.display_name as string | undefined) ?? null
    isCommish = m ? (m.is_commish as boolean) : null
  }
  return NextResponse.json(
    { managerId: displayName === null ? null : managerId, displayName, isCommish },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/**
 * Sign in to a seat, or redeem a reset link (which sets the PIN the member chose and
 * signs them in). The rules — five wrong PINs lock a seat, an empty seat cannot be
 * claimed here, a link works once — live in src/server/pin-service.ts so they can be
 * tested without a request.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: 'Bad request' }, { status: 400 })
  }
  const body = parsed.data
  const result =
    'resetToken' in body ? await redeemPinReset(body.resetToken, body.pin) : await signIn(body.managerId, body.pin)
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason },
      { status: result.status, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const res = NextResponse.json(
    { ok: true, managerId: result.managerId, displayName: result.displayName },
    { headers: { 'Cache-Control': 'no-store' } },
  )
  res.cookies.set(SESSION_COOKIE, signSession(result.managerId, sessionSecret()), SESSION_COOKIE_OPTIONS)
  return res
}

/** Sign out — mainly for testing and for handing a laptop to someone else. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, '', { ...SESSION_COOKIE_OPTIONS, maxAge: 0 })
  return res
}
