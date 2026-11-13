/**
 * Activity tracking, against a REAL Postgres database (docs/ACTIVITY_ROADMAP.md).
 * ⚠️ Writes and deletes page_visits. Guarded by ALLOW_DB_RESET=1 — see draft-service.itest.ts.
 * Needs `db:migrate-activity -- --test` first.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The routes read the signed session through next/headers, which does not exist
// outside a request. Swap the one function that touches it.
const session = vi.hoisted(() => ({ id: null as number | null }))
vi.mock('./session', () => ({ currentManagerId: async () => session.id }))

import { getSql } from './sql'
import { getState } from './draft-service'
import { CAP_ROWS } from './activity-service'
import { POST as track } from '@/app/api/track/route'
import { GET as activityGet } from '@/app/api/admin/activity/route'

const ENABLED = process.env.ALLOW_DB_RESET === '1' && !!process.env.DATABASE_URL
const d = ENABLED ? describe : describe.skip

d('activity tracking (real Postgres)', () => {
  const sql = getSql()
  let ids: number[] = []
  let commishIds: number[] = []

  beforeAll(async () => {
    const ms = (await sql`SELECT id, is_commish FROM managers ORDER BY draft_slot`) as Array<{
      id: number
      is_commish: boolean
    }>
    ids = ms.map((m) => Number(m.id))
    commishIds = ms.filter((m) => m.is_commish).map((m) => Number(m.id))
    await sql`UPDATE managers SET is_commish = (id = ${ids[0]})`
  })

  beforeEach(async () => {
    await sql`DELETE FROM page_visits`
    session.id = null
  })

  afterAll(async () => {
    await sql`DELETE FROM page_visits`
    await sql`UPDATE managers SET is_commish = (id = ANY(${commishIds}::int[]))`
  })

  const post = (body: unknown) =>
    track(new Request('http://x/api/track', { method: 'POST', body: JSON.stringify(body) }))
  const seg = (over: Record<string, unknown> = {}) => ({
    path: '/history/records',
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    activeSeconds: 42,
    ...over,
  })
  const rows = async () =>
    (await sql`SELECT manager_id, path, started_at, active_seconds FROM page_visits ORDER BY id`) as Array<{
      manager_id: number
      path: string
      started_at: string
      active_seconds: number
    }>

  it('takes the manager from the cookie and ignores a managerId in the body', async () => {
    session.id = ids[3]
    const res = await post({ ...seg(), managerId: ids[7] })
    expect(res.status).toBe(204)
    const [r] = await rows()
    expect(Number(r.manager_id)).toBe(ids[3])
    expect(r.active_seconds).toBe(42)
  })

  it('answers 401 signed out and writes nothing', async () => {
    expect((await post(seg())).status).toBe(401)
    expect(await rows()).toHaveLength(0)
  })

  it('answers 400 to bad input', async () => {
    session.id = ids[1]
    for (const bad of [{}, seg({ path: 'nope' }), seg({ activeSeconds: 'lots' }), seg({ startedAt: 'yesterday' })]) {
      expect((await post(bad)).status, JSON.stringify(bad)).toBe(400)
    }
    const raw = await track(new Request('http://x/api/track', { method: 'POST', body: 'not json' }))
    expect(raw.status).toBe(400)
    expect(await rows()).toHaveLength(0)
  })

  it('stores the path without its query string, and never records /join', async () => {
    session.id = ids[1]
    await post(seg({ path: '/history/members/4?season=2024#x' }))
    expect((await post(seg({ path: '/join?next=%2Fdraft' }))).status).toBe(204)
    expect((await rows()).map((r) => r.path)).toEqual(['/history/members/4'])
  })

  it('clamps seconds to 1800 and startedAt to the last day', async () => {
    session.id = ids[2]
    await post(seg({ activeSeconds: 20_000, startedAt: '2020-01-01T00:00:00.000Z' }))
    await post(seg({ startedAt: new Date(Date.now() + 86_400_000).toISOString() }))
    const [a, b] = await rows()
    expect(a.active_seconds).toBe(1800)
    expect(Date.now() - new Date(a.started_at).getTime()).toBeLessThanOrEqual(86_400_000 + 5_000)
    expect(new Date(b.started_at).getTime()).toBeLessThanOrEqual(Date.now() + 1_000)
  })

  it('refuses a runaway tab past the cap', async () => {
    session.id = ids[4]
    await sql`
      INSERT INTO page_visits (manager_id, path, started_at, active_seconds)
      SELECT ${ids[4]}, '/draft', now(), 5 FROM generate_series(1, ${CAP_ROWS})`
    expect((await post(seg())).status).toBe(429)
    // Somebody else is not affected.
    session.id = ids[5]
    expect((await post(seg())).status).toBe(204)
  })

  it('leaves /api/state and the fingerprint byte-identical', async () => {
    const before = await getState()
    session.id = ids[6]
    for (let i = 0; i < 3; i++) expect((await post(seg({ path: `/history/players/${i}` }))).status).toBe(204)
    const after = await getState()
    expect(after.version).toBe(before.version)
    // serverTime is the one field that is allowed to move between two reads.
    const strip = (s: unknown) => JSON.stringify({ ...(s as object), serverTime: undefined })
    expect(strip(after)).toBe(strip(before))
    expect(JSON.stringify(after)).not.toContain('page_visits')
  })

  describe('/api/admin/activity', () => {
    const get = (q = '') => activityGet(new Request(`http://x/api/admin/activity${q}`))

    it('answers 401 signed out and 403 to a member', async () => {
      expect((await get()).status).toBe(401)
      session.id = ids[1]
      expect((await get()).status).toBe(403)
    })

    it('summarises for the commissioner, hiding their own visits unless asked', async () => {
      session.id = ids[1]
      await post(seg({ path: '/draft', activeSeconds: 100 }))
      await post(seg({ path: '/history/members/2', activeSeconds: 50 }))
      session.id = ids[0]
      await post(seg({ path: '/draft', activeSeconds: 7 }))

      const res = await get('?days=7')
      expect(res.status).toBe(200)
      expect(res.headers.get('cache-control')).toContain('no-store')
      const body = await res.json()
      expect(body.totalSeconds).toBe(150)
      expect(body.byManager.map((m: { managerId: number }) => m.managerId)).toEqual([ids[1]])
      expect(body.byPage.map((p: { label: string }) => p.label)).toEqual(['Draft Room', 'Member page'])
      expect(body.members).toHaveLength(ids.length)
      expect(JSON.stringify(body)).not.toContain('pin')

      const mine = await (await get('?days=all&mine=1')).json()
      expect(mine.totalSeconds).toBe(157)
    })
  })
})
