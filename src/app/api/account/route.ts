import { NextResponse } from 'next/server'
import { z } from 'zod'
import { renameManager } from '@/server/commish-service'
import { listLinkedAccounts, MAX_DISPLAY_NAME } from '@/server/onboarding-service'
import { changePin } from '@/server/pin-service'
import { currentManagerId } from '@/server/session'
import { getSql } from '@/server/sql'

/**
 * The caller's own account.
 *
 *   GET  /api/account                                        name, linked accounts
 *   POST /api/account { action: 'changePin', currentPin, newPin }
 *   POST /api/account { action: 'rename', displayName }
 *
 * **The manager id comes from the signed session cookie, never the body** — there is
 * no id field to send, exactly like /api/queue. A route that took one would let anyone
 * rename anyone by changing a number.
 */
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, private' }

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('changePin'), currentPin: z.string().max(10), newPin: z.string().max(10) }),
  z.object({ action: z.literal('rename'), displayName: z.string().max(MAX_DISPLAY_NAME * 2) }),
])

const signedOut = () =>
  NextResponse.json({ ok: false, reason: 'Not signed in' }, { status: 401, headers: NO_STORE })

export async function GET() {
  const id = await currentManagerId()
  if (id === null) return signedOut()
  const [me] = await getSql()`SELECT display_name FROM managers WHERE id = ${id}`
  if (!me) return signedOut()
  return NextResponse.json(
    { ok: true, displayName: me.display_name as string, linked: await listLinkedAccounts(id) },
    { headers: NO_STORE },
  )
}

export async function POST(req: Request) {
  const id = await currentManagerId()
  if (id === null) return signedOut()
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: 'Bad request' }, { status: 400, headers: NO_STORE })
  }
  const b = parsed.data

  if (b.action === 'changePin') {
    const r = await changePin(id, b.currentPin, b.newPin)
    return NextResponse.json(r.ok ? { ok: true } : { ok: false, reason: r.reason }, {
      status: r.ok ? 200 : r.status,
      headers: NO_STORE,
    })
  }

  const name = b.displayName.trim().replace(/\s+/g, ' ')
  if (name.length > MAX_DISPLAY_NAME) {
    return NextResponse.json(
      { ok: false, reason: `Keep the name to ${MAX_DISPLAY_NAME} characters or fewer.` },
      { status: 400, headers: NO_STORE },
    )
  }
  const [taken] = await getSql()`
    SELECT 1 FROM managers WHERE id <> ${id} AND (lower(display_name) = lower(${name}) OR lower(name) = lower(${name}))`
  if (taken) {
    return NextResponse.json(
      { ok: false, reason: 'Someone in the league already goes by that name.' },
      { status: 409, headers: NO_STORE },
    )
  }
  // The same rename the commissioner uses: it follows into this season's board snapshot
  // and bumps rev, and leaves past seasons with the name that was on the board that night.
  const r = await renameManager(id, name)
  return NextResponse.json(r, { status: r.ok ? 200 : 400, headers: NO_STORE })
}
