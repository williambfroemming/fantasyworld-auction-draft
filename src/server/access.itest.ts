/**
 * PIN lockout and the Oracle switch, against a REAL Postgres database. Same guards as the
 * other integration suites. Needs `db:migrate-access -- --test` first.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hashPin } from '@/lib/auth'
import { issuePinReset } from './commish-service'
import { changePin, redeemPinReset, signIn } from './pin-service'
import { oracleAdminSummary, oracleEnabled, setOracleEnabled } from './settings-service'
import { getSql } from './sql'

const ENABLED = process.env.ALLOW_DB_RESET === '1' && !!process.env.DATABASE_URL
const d = ENABLED ? describe : describe.skip

d('PIN lockout (real Postgres)', () => {
  const sql = getSql()
  let id = 0
  let other = 0

  beforeAll(async () => {
    const m = (await sql`SELECT id FROM managers ORDER BY draft_slot LIMIT 2`) as Array<{ id: number }>
    id = m[0].id
    other = m[1].id
  })
  beforeEach(async () => {
    await sql`UPDATE managers SET pin_hash = ${await hashPin('1234')}, pin_attempts = 0, pin_locked_until = NULL`
  })
  afterAll(async () => {
    await sql`UPDATE managers SET pin_hash = NULL, pin_attempts = 0, pin_locked_until = NULL`
  })

  const status = async (pin: string, who = id) => {
    const r = await signIn(who, pin)
    return r.ok ? 200 : r.status
  }

  it('counts down the tries, then locks on the fifth wrong PIN', async () => {
    const first = await signIn(id, '0000')
    expect(first.ok).toBe(false)
    if (!first.ok) expect(first.reason).toMatch(/4 tries left/)
    for (let i = 0; i < 3; i++) expect(await status('0000')).toBe(401)
    const fifth = await signIn(id, '0000')
    expect(fifth.ok).toBe(false)
    if (!fifth.ok) {
      expect(fifth.status).toBe(429)
      expect(fifth.reason).toMatch(/15 minutes/)
    }
  })

  it('refuses even the CORRECT PIN while locked', async () => {
    for (let i = 0; i < 5; i++) await status('0000')
    expect(await status('1234')).toBe(429)
  })

  it('lets the fifth attempt succeed if it is right, and zeroes the count', async () => {
    for (let i = 0; i < 4; i++) expect(await status('0000')).toBe(401)
    expect(await status('1234')).toBe(200)
    const [row] = await sql`SELECT pin_attempts, pin_locked_until FROM managers WHERE id = ${id}`
    expect(row.pin_attempts).toBe(0)
    expect(row.pin_locked_until).toBeNull()
    // and a fresh run of five is available again
    for (let i = 0; i < 4; i++) expect(await status('0000')).toBe(401)
  })

  it('starts a fresh count once the lock has expired', async () => {
    for (let i = 0; i < 5; i++) await status('0000')
    await sql`UPDATE managers SET pin_locked_until = now() - interval '1 minute' WHERE id = ${id}`
    expect(await status('1234')).toBe(200)
    await sql`UPDATE managers SET pin_attempts = 5, pin_locked_until = now() - interval '1 minute' WHERE id = ${id}`
    const r = await signIn(id, '0000')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/4 tries left/) // 1 used, not 6
  })

  it('does not let parallel guesses slip past the limit', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => status('0000')))
    expect(results.filter((s) => s === 401).length).toBeLessThanOrEqual(4)
    expect(results.filter((s) => s === 429).length).toBeGreaterThanOrEqual(8)
    const [row] = await sql`SELECT pin_attempts FROM managers WHERE id = ${id}`
    expect(row.pin_attempts).toBeLessThanOrEqual(5)
    expect(await status('1234')).toBe(429)
  })

  it('locks one seat without touching another', async () => {
    for (let i = 0; i < 5; i++) await status('0000')
    expect(await status('1234', other)).toBe(200)
  })

  it('is lifted at once by using a commissioner reset link', async () => {
    for (let i = 0; i < 5; i++) await status('0000')
    const r = await issuePinReset(id)
    if (!r.ok) throw new Error('issue failed')
    expect((await redeemPinReset(r.data.token, '9876')).ok).toBe(true)
    expect(await status('9876')).toBe(200)
  })

  it('refuses to let anyone claim a seat that has no PIN', async () => {
    // This used to succeed: the first visitor to type four digits owned the seat.
    await sql`UPDATE managers SET pin_hash = NULL WHERE id = ${id}`
    const r = await signIn(id, '4321')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(403)
    const [row] = await sql`SELECT pin_hash, pin_attempts FROM managers WHERE id = ${id}`
    expect(row.pin_hash).toBeNull()
    expect(row.pin_attempts).toBe(0)
  })

  it('changes a PIN only with the right current PIN', async () => {
    expect((await changePin(id, '1234', '5555')).ok).toBe(true)
    expect(await status('1234')).toBe(401)
    expect(await status('5555')).toBe(200)
  })

  it('counts a wrong current PIN on the account page toward the same lock', async () => {
    for (let i = 0; i < 4; i++) expect((await changePin(id, '0000', '5555')).ok).toBe(false)
    const fifth = await changePin(id, '0000', '5555')
    expect(fifth.ok).toBe(false)
    if (!fifth.ok) expect(fifth.status).toBe(429)
    expect(await status('1234')).toBe(429)
  })
})

d('Oracle switch (real Postgres)', () => {
  const sql = getSql()
  let id = 0
  beforeAll(async () => {
    id = ((await sql`SELECT id FROM managers ORDER BY draft_slot LIMIT 1`) as Array<{ id: number }>)[0].id
  })
  beforeEach(async () => {
    await sql`DELETE FROM app_settings`
    await sql`DELETE FROM oracle_log`
  })
  afterAll(async () => {
    await sql`DELETE FROM app_settings`
    await sql`DELETE FROM oracle_log`
  })

  it('is on by default, off when switched, on again when switched back', async () => {
    expect(await oracleEnabled()).toBe(true)
    await setOracleEnabled(false, id)
    expect(await oracleEnabled()).toBe(false)
    await setOracleEnabled(true, id)
    expect(await oracleEnabled()).toBe(true)
  })

  it('keeps one row however often it is flipped, and records who', async () => {
    await setOracleEnabled(false, id)
    await setOracleEnabled(false, id)
    await setOracleEnabled(true, id)
    const rows = await sql`SELECT * FROM app_settings`
    expect(rows).toHaveLength(1)
    expect(rows[0].updated_by).toBe(id)
  })

  it('summarises the cost so far', async () => {
    await sql`INSERT INTO oracle_log (manager_id, question, ok, input_tokens, output_tokens)
              VALUES (${id}, 'a', true, 1000, 100), (${id}, 'b', true, 2000, 50)`
    await sql`INSERT INTO oracle_log (manager_id, question, ok, input_tokens, output_tokens, created_at)
              VALUES (${id}, 'old', true, 500, 10, now() - interval '3 days')`
    const s = await oracleAdminSummary()
    expect(s.enabled).toBe(true)
    expect(s.last24h).toEqual({ questions: 2, inputTokens: 3000, outputTokens: 150 })
    expect(s.allTime).toEqual({ questions: 3, inputTokens: 3500, outputTokens: 160 })
    expect(s.topAskers24h[0].questions).toBe(2)
  })
})
