import { MAX_SECONDS, type VisitRow } from '@/lib/activity'
import { getSql } from './sql'

/**
 * First-party activity tracking: the database half (docs/archive/ACTIVITY_ROADMAP.md).
 *
 * ⚠️ Nothing here is on the polling path. `page_visits` is not read by
 * `getState()`, not part of the fingerprint in src/lib/version.ts, and has no
 * view in the `oracle` schema. The write is reached only from `/api/track`
 * (any signed-in member, their own id from the cookie) and the read only from
 * `/api/admin/activity` (commissioner only).
 */

/** More than this many rows for one manager in `CAP_WINDOW_MIN` and further writes are refused. */
export const CAP_ROWS = 120
export const CAP_WINDOW_MIN = 10

export type RecordResult = { ok: true } | { ok: false; reason: 'capped' }

/**
 * One segment, ONE statement: the abuse cap and the insert together, so a
 * burst of parallel beacons cannot all read "under the cap" before any lands.
 * (The count is not locked, so a burst can overshoot by its own size; that is
 * fine for a friendly league. The cap is there to stop a runaway tab, not an
 * adversary.)
 *
 * `startedAt` is the client's clock, so it is clamped to the last day against
 * the database's `now()`. Seconds are clamped to 1..MAX_SECONDS, which the
 * column CHECK enforces too.
 */
export async function recordVisit(
  managerId: number,
  v: { path: string; startedAt: Date; activeSeconds: number },
): Promise<RecordResult> {
  const secs = Math.min(MAX_SECONDS, Math.max(1, Math.round(v.activeSeconds)))
  const started = Number.isFinite(v.startedAt.getTime()) ? v.startedAt.toISOString() : new Date().toISOString()
  const rows = await getSql()`
    INSERT INTO page_visits (manager_id, path, started_at, active_seconds)
    SELECT ${managerId}, ${v.path},
           GREATEST(now() - interval '1 day', LEAST(now(), ${started}::timestamptz)),
           ${secs}
     WHERE (SELECT count(*) FROM page_visits
             WHERE manager_id = ${managerId}
               AND created_at > now() - make_interval(mins => ${CAP_WINDOW_MIN})) < ${CAP_ROWS}
    RETURNING id`
  return rows.length ? { ok: true } : { ok: false, reason: 'capped' }
}

/** Rows for the admin view, `since` inclusive (null = everything on record). */
export async function getActivity(since: Date | null): Promise<VisitRow[]> {
  const sql = getSql()
  const rows = since
    ? await sql`
        SELECT manager_id, path, started_at, active_seconds FROM page_visits
         WHERE started_at >= ${since.toISOString()}::timestamptz ORDER BY started_at`
    : await sql`
        SELECT manager_id, path, started_at, active_seconds FROM page_visits ORDER BY started_at`
  return rows.map((r) => ({
    managerId: Number(r.manager_id),
    path: String(r.path),
    startedAt: new Date(r.started_at as string),
    activeSeconds: Number(r.active_seconds),
  }))
}

/** Names and colours for the admin view. No PIN state: this route does not need it. */
export async function activityMembers(): Promise<Array<{ id: number; name: string; color: string }>> {
  const rows = await getSql()`SELECT id, display_name, color FROM managers ORDER BY draft_slot, id`
  return rows.map((r) => ({ id: Number(r.id), name: r.display_name as string, color: r.color as string }))
}
