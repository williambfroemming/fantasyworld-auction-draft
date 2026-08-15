import { NextResponse } from 'next/server'
import { z } from 'zod'
import { awardLot } from '@/server/draft-service'
import { currentManagerId } from '@/server/session'

export const dynamic = 'force-dynamic'

const Body = z.object({
  lotId: z.number().int().positive(),
  winnerId: z.number().int().positive(),
  price: z.number().int().min(1).max(10_000),
})

export async function POST(req: Request) {
  // The caller is taken from the signed cookie, never the body — awardLot uses
  // it to check that whoever is recording the sale actually ran the bidding.
  const managerId = await currentManagerId()
  if (managerId === null) {
    return NextResponse.json({ ok: false, reason: 'Not signed in' }, { status: 401 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: 'Bad request' }, { status: 400 })
  }

  const { lotId, winnerId, price } = parsed.data
  const result = await awardLot(managerId, lotId, winnerId, price)
  // A refused award is a normal outcome (someone called out a price above the
  // winner's max), not a server error — 200 with ok:false so the reason lands
  // on screen without console noise.
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
