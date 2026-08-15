import { NextResponse } from 'next/server'
import { z } from 'zod'
import { awardLot, nominate } from '@/server/draft-service'
import { executeTrade } from '@/server/trade-service'
import { TEST_SEATS_ENABLED } from '@/lib/test-mode'

export const dynamic = 'force-dynamic'

/**
 * Act as any manager, without their PIN. TEST ONLY.
 *
 * Note it calls the *same* nominate/awardLot/executeTrade functions as the real
 * routes — it bypasses only authentication, never the auction rules. An award
 * made here is subject to max bid and the atomic statement exactly as a real one
 * is, which is what makes it a valid way to verify behaviour.
 */
const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('nominate'),
    managerId: z.number().int(),
    playerId: z.string(),
  }),
  z.object({
    action: z.literal('award'),
    managerId: z.number().int(),
    lotId: z.number().int(),
    winnerId: z.number().int(),
    price: z.number().int(),
  }),
  z.object({
    action: z.literal('trade'),
    managerId: z.number().int(),
    aId: z.number().int(),
    bId: z.number().int(),
    picksAToB: z.array(z.number().int()),
    picksBToA: z.array(z.number().int()),
    cashAToB: z.number().int(),
    cashBToA: z.number().int(),
  }),
])

export async function POST(req: Request) {
  if (!TEST_SEATS_ENABLED) {
    return NextResponse.json({ ok: false, reason: 'Not found' }, { status: 404 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: 'Bad request' }, { status: 400 })
  }
  const b = parsed.data

  const result = await (async () => {
    switch (b.action) {
      case 'nominate':
        return nominate(b.managerId, b.playerId)
      case 'award':
        return awardLot(b.managerId, b.lotId, b.winnerId, b.price)
      case 'trade':
        return executeTrade(b.managerId, {
          aId: b.aId,
          bId: b.bId,
          picksAToB: b.picksAToB,
          picksBToA: b.picksBToA,
          cashAToB: b.cashAToB,
          cashBToA: b.cashBToA,
        })
    }
  })()

  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
