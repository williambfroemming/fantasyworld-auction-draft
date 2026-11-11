import { NextResponse } from 'next/server'
import { activitySummary } from '@/lib/activity'
import { activityMembers, getActivity } from '@/server/activity-service'
import { checkCommish } from '@/server/require-commish'

/**
 * Who uses which pages, for how long (docs/ACTIVITY_ROADMAP.md).
 *
 *   GET /api/admin/activity?days=7|30|all&mine=0|1
 *
 * Commissioner only, decided from the database against the signed session.
 * Kept apart from `/api/admin` so the panel's main load stays light, and so the
 * one place `page_visits` is read is obvious. `mine=1` includes the
 * commissioner's own browsing; the default hides it.
 */
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, private' }
const RANGES = { '7': 7, '30': 30, all: null } as const

export async function GET(req: Request) {
  const who = await checkCommish()
  if (!who.ok) {
    return NextResponse.json({ ok: false, reason: who.reason }, { status: who.status, headers: NO_STORE })
  }
  const q = new URL(req.url).searchParams
  const range = (q.get('days') ?? '7') as keyof typeof RANGES
  const days = range in RANGES ? RANGES[range] : 7
  const includeMine = q.get('mine') === '1'

  const since = days === null ? null : new Date(Date.now() - days * 86_400_000)
  const [rows, members] = await Promise.all([getActivity(since), activityMembers()])
  const summary = activitySummary(rows, { from: since, excludeIds: includeMine ? [] : [who.id] })

  return NextResponse.json(
    { ok: true, me: who.id, days, includeMine, members, ...summary },
    { headers: NO_STORE },
  )
}
