import { NextResponse } from 'next/server'
import { z } from 'zod'
import { addToQueue, getQueue, pruneQueue, removeFromQueue } from '@/server/queue-service'
import { currentManagerId } from '@/server/session'

/**
 * The caller's own player queue (docs/BACKLOG.md §4).
 *
 *   GET  /api/queue                              your queue
 *   POST /api/queue { action, playerId? }        add / remove / prune
 *
 * ## Two rules this route exists to keep
 *
 * 1. **The manager id comes from the signed session cookie, never the body.**
 *    There is deliberately no `managerId` field to send. A queue is private, and
 *    a route that accepted an id would let anyone read anyone's targets by
 *    changing a number.
 * 2. **This is off the polling path entirely.** The queue is not in `/api/state`
 *    and not in the fingerprint (`src/lib/version.ts`), so a private edit never
 *    invalidates anyone else's 204.
 *
 * `no-store` matters more here than elsewhere: a cached queue response served to
 * a second manager would be a privacy leak, not just a stale board.
 */
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, private' }

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), playerId: z.string().min(1) }),
  z.object({ action: z.literal('remove'), playerId: z.string().min(1) }),
  z.object({ action: z.literal('prune') }),
])

export async function GET() {
  const managerId = await currentManagerId()
  if (managerId === null) {
    return NextResponse.json({ ok: false, reason: 'Not signed in' }, { status: 401 })
  }
  return NextResponse.json({ ok: true, queue: await getQueue(managerId) }, { headers: NO_STORE })
}

export async function POST(req: Request) {
  const managerId = await currentManagerId()
  if (managerId === null) {
    return NextResponse.json({ ok: false, reason: 'Not signed in' }, { status: 401 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: 'Bad request' }, { status: 400 })
  }
  const body = parsed.data

  const result =
    body.action === 'add'
      ? await addToQueue(managerId, body.playerId)
      : body.action === 'remove'
        ? await removeFromQueue(managerId, body.playerId)
        : await pruneQueue(managerId)

  if (!result.ok) return NextResponse.json(result, { headers: NO_STORE })

  // Return the whole queue so the client never has to guess at the new state.
  return NextResponse.json(
    { ok: true, queue: await getQueue(managerId) },
    { headers: NO_STORE },
  )
}
