import { NextResponse } from 'next/server'
import { z } from 'zod'
import { placeBid } from '@/server/draft-service'
import { currentManagerId } from '@/server/session'

export const dynamic = 'force-dynamic'

const Body = z.object({
  lotId: z.number().int().positive(),
  amount: z.number().int().positive(),
})

export async function POST(req: Request) {
  // The bidder is taken from the signed cookie, never from the body — otherwise
  // anyone could spend another manager's budget.
  const managerId = await currentManagerId()
  if (managerId === null) {
    return NextResponse.json({ ok: false, reason: 'Not signed in' }, { status: 401 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: 'Bad request' }, { status: 400 })
  }

  const result = await placeBid(managerId, parsed.data.lotId, parsed.data.amount)
  // A losing bid is a normal outcome in an auction, not a server error — 200
  // with ok:false so the client can show the reason without console noise.
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
