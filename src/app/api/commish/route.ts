import { NextResponse } from 'next/server'
import { z } from 'zod'
import * as commish from '@/server/commish-service'
import { currentManagerId } from '@/server/session'
import { getSql } from '@/server/sql'

export const dynamic = 'force-dynamic'

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('skipNominator') }),
  z.object({ action: z.literal('voidLot') }),
  z.object({ action: z.literal('undoLastPick') }),
  z.object({ action: z.literal('adjustClock'), deltaSeconds: z.number().int().min(-300).max(300) }),
  z.object({
    action: z.literal('setTimers'),
    timerSeconds: z.number().int(),
    softCloseSeconds: z.number().int(),
  }),
  z.object({ action: z.literal('editPrice'), pickId: z.number().int(), price: z.number().int() }),
  z.object({
    action: z.literal('reassignPick'),
    pickId: z.number().int(),
    managerId: z.number().int(),
  }),
  z.object({ action: z.literal('setStatus'), status: z.enum(['setup', 'live', 'done']) }),
  z.object({ action: z.literal('setDraftOrder'), managerIds: z.array(z.number().int()) }),
  z.object({ action: z.literal('swapSeats'), aId: z.number().int(), bId: z.number().int() }),
  z.object({ action: z.literal('clearPin'), managerId: z.number().int() }),
])

export async function POST(req: Request) {
  // Commissioner status is read from the database against the signed session —
  // never taken from the request.
  const managerId = await currentManagerId()
  if (managerId === null) {
    return NextResponse.json({ ok: false, reason: 'Not signed in' }, { status: 401 })
  }
  const [me] = await getSql()`SELECT is_commish FROM managers WHERE id = ${managerId}`
  if (!me?.is_commish) {
    return NextResponse.json({ ok: false, reason: 'Commissioner only' }, { status: 403 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: 'Bad request' }, { status: 400 })
  }
  const b = parsed.data

  const result = await (async () => {
    switch (b.action) {
      case 'pause': return commish.pause()
      case 'resume': return commish.resume()
      case 'skipNominator': return commish.skipNominator()
      case 'voidLot': return commish.voidLot()
      case 'undoLastPick': return commish.undoLastPick()
      case 'adjustClock': return commish.adjustClock(b.deltaSeconds)
      case 'setTimers': return commish.setTimers(b.timerSeconds, b.softCloseSeconds)
      case 'editPrice': return commish.editPrice(b.pickId, b.price)
      case 'reassignPick': return commish.reassignPick(b.pickId, b.managerId)
      case 'setStatus': return commish.setStatus(b.status)
      case 'setDraftOrder': return commish.setDraftOrder(b.managerIds)
      case 'swapSeats': return commish.swapSeats(b.aId, b.bId)
      case 'clearPin': return commish.clearPin(b.managerId)
    }
  })()

  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
