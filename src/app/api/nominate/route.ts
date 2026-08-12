import { NextResponse } from 'next/server'
import { z } from 'zod'
import { nominate } from '@/server/draft-service'
import { currentManagerId } from '@/server/session'

export const dynamic = 'force-dynamic'

const Body = z.object({
  playerId: z.string().min(1),
  openingBid: z.number().int().positive(),
})

export async function POST(req: Request) {
  const managerId = await currentManagerId()
  if (managerId === null) {
    return NextResponse.json({ ok: false, reason: 'Not signed in' }, { status: 401 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: 'Bad request' }, { status: 400 })
  }

  const result = await nominate(managerId, parsed.data.playerId, parsed.data.openingBid)
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}
