/**
 * Sign-up for new members and the /account route, against a REAL Postgres database.
 * ⚠️ Changes draft state. Guarded by ALLOW_DB_RESET=1 — see draft-service.itest.ts.
 * Needs `db:migrate-accounts -- --test` first.
 *
 * Sleeper is stubbed: the point is what the app does with a proof, not whether the
 * Sleeper API is up. The real provider's pure parts are unit-tested in
 * src/lib/identity/identity.test.ts.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPin } from '@/lib/auth'
import { containsCode, type IdentityProvider } from '@/lib/identity/provider'

const session = vi.hoisted(() => ({ id: null as number | null }))
vi.mock('./session', () => ({ currentManagerId: async () => session.id }))

import { getSql } from './sql'
import { approveJoinRequest, declineJoinRequest } from './commish-service'
import { listJoinRequests, startChallenge, submitJoinRequest } from './onboarding-service'
import { signIn } from './pin-service'
import { GET as accountGet, POST as accountPost } from '@/app/api/account/route'

const ENABLED = process.env.ALLOW_DB_RESET === '1' && !!process.env.DATABASE_URL
const d = ENABLED ? describe : describe.skip

const NEW_USER = 'itest-new-user'
const LINKED_USER = 'itest-linked-user'

/** A fake Sleeper: two accounts in the league, team names we control. */
const teamNames = new Map<string, string>()
const fake: IdentityProvider = {
  id: 'sleeper',
  label: 'Sleeper',
  async lookupMember(username) {
    if (username === 'newbie') return { ok: true, user: { userId: NEW_USER, username: 'newbie' } }
    if (username === 'already') return { ok: true, user: { userId: LINKED_USER, username: 'already' } }
    return { ok: false, reason: 'not in this league' }
  },
  async hasChallenge(userId, code) {
    return containsCode(teamNames.get(userId), code) // the real provider's matching rule
  },
  instructions: (code) => `put ${code} in your team name`,
}

d('sign-up and accounts (real Postgres)', () => {
  const sql = getSql()
  let first = 0
  let season = 0
  let savedStatus = 'setup'

  beforeAll(async () => {
    first = ((await sql`SELECT id FROM managers ORDER BY draft_slot LIMIT 1`) as Array<{ id: number }>)[0].id
    const [dr] = await sql`SELECT season, status FROM draft WHERE id = 1`
    season = Number(dr.season)
    savedStatus = dr.status as string
    await sql`
      INSERT INTO member_identities (manager_id, provider, external_user_id)
      VALUES (${first}, 'sleeper', ${LINKED_USER}) ON CONFLICT DO NOTHING`
  })
  beforeEach(async () => {
    teamNames.clear()
    await sql`DELETE FROM join_requests`
    await sql`DELETE FROM budget_adjustments WHERE season = ${season}`
    await sql`DELETE FROM trades WHERE season = ${season}`
    await sql`DELETE FROM picks WHERE season = ${season}`
    await sql`DELETE FROM lots WHERE season = ${season}`
    await sql`UPDATE draft SET status = 'setup', nomination_index = 0 WHERE id = 1`
  })
  afterAll(async () => {
    await sql`DELETE FROM join_requests`
    await sql`DELETE FROM member_identities WHERE external_user_id IN (${NEW_USER}, ${LINKED_USER})`
    const made = (await sql`SELECT id FROM managers WHERE name LIKE 'Itest Newbie%'`) as Array<{ id: number }>
    for (const m of made) {
      await sql`DELETE FROM season_orders WHERE manager_id = ${m.id}`
      await sql`DELETE FROM managers WHERE id = ${m.id}`
    }
    await sql`UPDATE draft SET status = ${savedStatus} WHERE id = 1`
    await sql`UPDATE managers SET pin_hash = NULL, pin_attempts = 0, pin_locked_until = NULL`
  })

  async function verifiedRequest(name = 'Itest Newbie', pin = '2468') {
    const c = await startChallenge('sleeper', 'newbie', fake)
    if (!c.ok) throw new Error(c.reason)
    teamNames.set(NEW_USER, `The Lads ${c.data.code}`)
    const r = await submitJoinRequest({ token: c.data.token, displayName: name, pin }, fake)
    if (!r.ok) throw new Error(r.reason)
  }

  it('hands an unlinked league member a code, and refuses an account that already has a seat', async () => {
    const c = await startChallenge('sleeper', 'newbie', fake)
    expect(c.ok).toBe(true)
    if (c.ok) expect(c.data.code).toMatch(/^FW-\d{4}$/)
    const linked = await startChallenge('sleeper', 'already', fake)
    expect(linked.ok).toBe(false)
    if (!linked.ok) expect(linked.reason).toMatch(/already has a seat/)
  })

  it('refuses the request until the code is in their team name', async () => {
    const c = await startChallenge('sleeper', 'newbie', fake)
    if (!c.ok) throw new Error(c.reason)
    teamNames.set(NEW_USER, 'The Lads')
    const before = await submitJoinRequest({ token: c.data.token, displayName: 'Itest Newbie', pin: '2468' }, fake)
    expect(before.ok).toBe(false)
    expect(await listJoinRequests()).toHaveLength(0)

    teamNames.set(NEW_USER, `The Lads ${c.data.code.toLowerCase()}`)
    const after = await submitJoinRequest({ token: c.data.token, displayName: 'Itest Newbie', pin: '2468' }, fake)
    expect(after.ok).toBe(true)
    const list = await listJoinRequests()
    expect(list).toHaveLength(1)
    expect(JSON.stringify(list)).not.toMatch(/pin|scrypt/i)
  })

  it('rejects a tampered token, and a code proved for a different account', async () => {
    const c = await startChallenge('sleeper', 'newbie', fake)
    if (!c.ok) throw new Error(c.reason)
    const [body, sig] = c.data.token.split('.')
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), userId: 'someone-else' }),
    ).toString('base64url')
    teamNames.set('someone-else', c.data.code)
    const r = await submitJoinRequest({ token: `${forged}.${sig}`, displayName: 'Itest Newbie', pin: '2468' }, fake)
    expect(r.ok).toBe(false)
  })

  it('refuses a name someone in the league already uses', async () => {
    const [m] = await sql`SELECT display_name FROM managers WHERE id = ${first}`
    const c = await startChallenge('sleeper', 'newbie', fake)
    if (!c.ok) throw new Error(c.reason)
    teamNames.set(NEW_USER, c.data.code)
    const r = await submitJoinRequest(
      { token: c.data.token, displayName: String(m.display_name).toUpperCase(), pin: '2468' },
      fake,
    )
    expect(r.ok).toBe(false)
  })

  it('will not approve while a draft is under way', async () => {
    await verifiedRequest()
    const [req] = await listJoinRequests()
    await sql`UPDATE draft SET status = 'live' WHERE id = 1`
    expect((await approveJoinRequest(req.id)).ok).toBe(false)
    await sql`UPDATE draft SET status = 'done' WHERE id = 1`
    expect((await approveJoinRequest(req.id)).ok).toBe(false)
    expect(await listJoinRequests()).toHaveLength(1)
  })

  it('approves into a real seat with the PIN they chose, linked, once', async () => {
    const [{ n: before }] = await sql`SELECT count(*)::int AS n FROM managers`
    await verifiedRequest()
    const [req] = await listJoinRequests()
    const r = await approveJoinRequest(req.id)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect((await signIn(r.data.managerId, '2468')).ok).toBe(true)
    const [link] = await sql`
      SELECT manager_id, verified_at FROM member_identities WHERE external_user_id = ${NEW_USER}`
    expect(Number(link.manager_id)).toBe(r.data.managerId)
    expect(link.verified_at).not.toBeNull()
    const [{ n: after }] = await sql`SELECT count(*)::int AS n FROM managers`
    expect(after).toBe(before + 1)
    expect((await approveJoinRequest(req.id)).ok).toBe(false)
    // and now the account is linked, it cannot start again
    expect((await startChallenge('sleeper', 'newbie', fake)).ok).toBe(false)
  })

  it('declines', async () => {
    await sql`DELETE FROM member_identities WHERE external_user_id = ${NEW_USER}`
    await verifiedRequest('Itest Newbie Two')
    const [req] = await listJoinRequests()
    expect((await declineJoinRequest(req.id)).ok).toBe(true)
    expect(await listJoinRequests()).toHaveLength(0)
  })

  describe('/api/account', () => {
    const post = (body: object) =>
      accountPost(new Request('http://x/api/account', { method: 'POST', body: JSON.stringify(body) }))

    it('is signed-in only', async () => {
      session.id = null
      expect((await accountGet()).status).toBe(401)
      expect((await post({ action: 'rename', displayName: 'x' })).status).toBe(401)
    })

    it('acts on the session seat, and ignores any id in the body', async () => {
      const [a, b] = (await sql`SELECT id, display_name FROM managers ORDER BY draft_slot LIMIT 2`) as Array<{
        id: number
        display_name: string
      }>
      session.id = a.id
      const res = await post({ action: 'rename', displayName: 'Itest Renamed', managerId: b.id })
      expect(res.status).toBe(200)
      const rows = (await sql`SELECT id, display_name FROM managers WHERE id IN (${a.id}, ${b.id})`) as Array<{
        id: number
        display_name: string
      }>
      expect(rows.find((r) => r.id === a.id)!.display_name).toBe('Itest Renamed')
      expect(rows.find((r) => r.id === b.id)!.display_name).toBe(b.display_name)
      await sql`UPDATE managers SET display_name = ${a.display_name} WHERE id = ${a.id}`
    })

    it('changes the PIN only with the current one', async () => {
      session.id = first
      await sql`UPDATE managers SET pin_hash = ${await hashPin('1234')}, pin_attempts = 0 WHERE id = ${first}`
      expect((await post({ action: 'changePin', currentPin: '0000', newPin: '5678' })).status).toBe(401)
      expect((await post({ action: 'changePin', currentPin: '1234', newPin: '5678' })).status).toBe(200)
      expect((await signIn(first, '5678')).ok).toBe(true)
    })
  })
})
