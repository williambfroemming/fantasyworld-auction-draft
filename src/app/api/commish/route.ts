import { NextResponse } from 'next/server'
import { z } from 'zod'
import * as commish from '@/server/commish-service'
import { checkCommish } from '@/server/require-commish'

export const dynamic = 'force-dynamic'

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('skipNominator') }),
  z.object({ action: z.literal('voidLot') }),
  z.object({ action: z.literal('undoLastPick') }),
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
  z.object({ action: z.literal('issuePinReset'), managerId: z.number().int() }),
  z.object({ action: z.literal('approveJoinRequest'), requestId: z.number().int() }),
  z.object({ action: z.literal('declineJoinRequest'), requestId: z.number().int() }),
  z.object({
    action: z.literal('setLeagueSettings'),
    startingBudget: z.number().int(),
    rosterSize: z.number().int(),
  }),
  z.object({
    action: z.literal('setSeasonDetails'),
    season: z.number().int().min(2000).max(2999),
    city: z.string().max(60).nullable(),
    state: z.string().max(40).nullable(),
    // Null is "unknown", never 0, and must survive a round trip as null.
    buyIn: z.number().int().min(0).max(100_000).nullable(),
    championPrize: z.number().int().min(0).max(100_000).nullable(),
    runnerUpPrize: z.number().int().min(0).max(100_000).nullable(),
    thirdPrize: z.number().int().min(0).max(100_000).nullable(),
    sideBet: z.number().int().min(0).max(100_000).nullable(),
  }),
  z.object({ action: z.literal('unlockSeat'), managerId: z.number().int() }),
  z.object({ action: z.literal('setCommish'), managerId: z.number().int(), on: z.boolean() }),
  z.object({
    action: z.literal('recordSale'),
    playerId: z.string().min(1).max(100),
    managerId: z.number().int(),
    price: z.number().int(),
  }),
  // The year must be typed twice — once as the target, once as the confirmation —
  // so a stray click cannot roll the league into a new season.
  z.object({
    action: z.literal('startNewSeason'),
    year: z.number().int(),
    confirm: z.number().int(),
  }),
  z.object({
    action: z.literal('renameManager'),
    managerId: z.number().int(),
    displayName: z.string().max(40),
  }),
  // Guarded by an explicit confirm string so a mis-click cannot wipe a draft.
  z.object({ action: z.literal('resetDraft'), confirm: z.literal('RESET') }),
])

export async function POST(req: Request) {
  // Commissioner status is read from the database against the signed session —
  // never taken from the request.
  const who = await checkCommish()
  if (!who.ok) {
    return NextResponse.json({ ok: false, reason: who.reason }, { status: who.status })
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
      case 'editPrice': return commish.editPrice(b.pickId, b.price)
      case 'reassignPick': return commish.reassignPick(b.pickId, b.managerId)
      case 'setStatus': return commish.setStatus(b.status)
      case 'setDraftOrder': return commish.setDraftOrder(b.managerIds)
      case 'swapSeats': return commish.swapSeats(b.aId, b.bId)
      case 'clearPin': return commish.clearPin(b.managerId)
      case 'issuePinReset': return commish.issuePinReset(b.managerId)
      case 'approveJoinRequest': return commish.approveJoinRequest(b.requestId)
      case 'declineJoinRequest': return commish.declineJoinRequest(b.requestId)
      case 'setLeagueSettings': return commish.setLeagueSettings(b.startingBudget, b.rosterSize)
      case 'setSeasonDetails': return commish.setSeasonDetails({
        season: b.season, city: b.city, state: b.state, buyIn: b.buyIn,
        championPrize: b.championPrize, runnerUpPrize: b.runnerUpPrize,
        thirdPrize: b.thirdPrize, sideBet: b.sideBet,
      })
      case 'unlockSeat': return commish.unlockSeat(b.managerId)
      case 'setCommish': return commish.setCommish(b.managerId, b.on)
      case 'recordSale': return commish.recordSale(b.playerId, b.managerId, b.price)
      case 'startNewSeason':
        if (b.confirm !== b.year) return { ok: false as const, reason: 'Type the new year to confirm' }
        return commish.startNewSeason(b.year)
      case 'renameManager': return commish.renameManager(b.managerId, b.displayName)
      case 'resetDraft': return commish.resetDraft()
    }
  })()

  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
