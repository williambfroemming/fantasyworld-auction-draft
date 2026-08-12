import { NextResponse } from 'next/server'
import { z } from 'zod'
import { nominate, placeBid } from '@/server/draft-service'
import { TEST_SEATS_ENABLED } from '@/lib/test-mode'

export const dynamic = 'force-dynamic'

/**
 * Act as any manager, without their PIN. TEST ONLY.
 *
 * Note it calls the *same* nominate/placeBid functions as the real routes — it
 * bypasses only authentication, never the auction rules. A bid placed here is
 * subject to max bid, the soft close, and the atomic UPDATE exactly as a real
 * one is, which is what makes it a valid way to verify behaviour.
 */
const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('bid'),
    managerId: z.number().int(),
    lotId: z.number().int(),
    amount: z.number().int(),
  }),
  z.object({
    action: z.literal('nominate'),
    managerId: z.number().int(),
    playerId: z.string(),
    openingBid: z.number().int(),
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

  const result =
    b.action === 'bid'
      ? await placeBid(b.managerId, b.lotId, b.amount)
      : await nominate(b.managerId, b.playerId, b.openingBid)

  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
