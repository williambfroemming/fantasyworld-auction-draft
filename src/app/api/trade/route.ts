import { NextResponse } from 'next/server'
import { z } from 'zod'
import { executeTrade } from '@/server/trade-service'
import { currentManagerId } from '@/server/session'

export const dynamic = 'force-dynamic'

const Body = z.object({
  aId: z.number().int().positive(),
  bId: z.number().int().positive(),
  picksAToB: z.array(z.number().int().positive()).max(40),
  picksBToA: z.array(z.number().int().positive()).max(40),
  cashAToB: z.number().int().min(0).max(10_000),
  cashBToA: z.number().int().min(0).max(10_000),
})

export async function POST(req: Request) {
  // Any signed-in manager may execute a trade the room has already agreed to —
  // the same call the auction itself makes. The caller is recorded on the trade
  // so a disputed one has a name attached to it.
  const managerId = await currentManagerId()
  if (managerId === null) {
    return NextResponse.json({ ok: false, reason: 'Not signed in' }, { status: 401 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: 'Bad request' }, { status: 400 })
  }

  const result = await executeTrade(managerId, parsed.data)
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
