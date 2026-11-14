import { NextResponse } from 'next/server'
import { z } from 'zod'
import { MAX_PATH, isUntrackedPath, normalisePath } from '@/lib/activity'
import { recordVisit } from '@/server/activity-service'
import { currentManagerId } from '@/server/session'

/**
 * One segment of active time on one page (docs/archive/ACTIVITY_ROADMAP.md).
 *
 *   POST /api/track { path, startedAt, activeSeconds }   → 204
 *
 * Sent by `<ActivityBeacon>` through `navigator.sendBeacon`, which is
 * same-origin and so carries the session cookie through src/proxy.ts like any
 * other request. A signed-out call never gets here: the proxy answers 401.
 *
 * ## Rules this route exists to keep
 *
 * 1. **The manager id comes from the signed session cookie, never the body.**
 *    There is no `managerId` field; one sent anyway is ignored (zod strips it).
 * 2. **Off the polling path.** Nothing here touches `/api/state`, `draft.rev` or
 *    the fingerprint in src/lib/version.ts. A track call must never wake a client.
 * 3. **First-party only.** No outbound call of any kind.
 */
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, private' }

const Body = z.object({
  path: z.string().min(1).max(MAX_PATH * 4),
  startedAt: z.iso.datetime(),
  activeSeconds: z.number().int().min(1).max(24 * 3600),
})

export async function POST(req: Request) {
  const managerId = await currentManagerId()
  if (managerId === null) {
    return NextResponse.json({ ok: false, reason: 'Not signed in' }, { status: 401, headers: NO_STORE })
  }

  // sendBeacon posts a Blob typed application/json; read it as text so a
  // missing or odd content-type is not a reason to drop it.
  const text = await req.text().catch(() => '')
  let json: unknown = null
  try {
    json = JSON.parse(text)
  } catch {}
  const parsed = Body.safeParse(json)
  const path = parsed.success ? normalisePath(parsed.data.path) : null
  if (!parsed.success || path === null) {
    return NextResponse.json({ ok: false, reason: 'Bad request' }, { status: 400, headers: NO_STORE })
  }
  if (isUntrackedPath(path)) return new NextResponse(null, { status: 204, headers: NO_STORE })

  const r = await recordVisit(managerId, {
    path,
    startedAt: new Date(parsed.data.startedAt),
    activeSeconds: parsed.data.activeSeconds,
  })
  if (!r.ok) {
    return NextResponse.json({ ok: false, reason: 'Too many' }, { status: 429, headers: NO_STORE })
  }
  return new NextResponse(null, { status: 204, headers: NO_STORE })
}
