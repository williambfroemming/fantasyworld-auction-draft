/**
 * The commissioner's PIN reset LINK, against a REAL Postgres database. Same guards as
 * the other integration suites. Needs `db:migrate-accounts -- --test` first.
 *
 * The properties that matter: the member chooses the PIN, the old PIN works right up
 * until the link is used (so the seat is never empty), and a link works exactly once.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { hashPin, hashResetToken, verifyPin } from '@/lib/auth'
import { issuePinReset } from './commish-service'
import { redeemPinReset, signIn } from './pin-service'
import { getSql } from './sql'

const ENABLED = process.env.ALLOW_DB_RESET === '1' && !!process.env.DATABASE_URL
const d = ENABLED ? describe : describe.skip

d('PIN reset links (real Postgres)', () => {
  const sql = getSql()
  let id = 0
  let other = 0

  beforeAll(async () => {
    const m = (await sql`SELECT id FROM managers ORDER BY draft_slot LIMIT 2`) as Array<{ id: number }>
    id = m[0].id
    other = m[1].id
  })
  beforeEach(async () => {
    await sql`UPDATE managers SET pin_hash = ${await hashPin('1234')}, pin_attempts = 0, pin_locked_until = NULL,
                                  pin_reset_hash = NULL, pin_reset_expires = NULL`
  })
  afterAll(async () => {
    await sql`UPDATE managers SET pin_hash = NULL, pin_attempts = 0, pin_locked_until = NULL,
                                  pin_reset_hash = NULL, pin_reset_expires = NULL`
  })

  async function link(who = id): Promise<string> {
    const r = await issuePinReset(who)
    if (!r.ok) throw new Error(r.reason)
    return r.data.token
  }

  it('sets the PIN the member chose and signs them in as the right seat', async () => {
    const r = await redeemPinReset(await link(), '7777')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.managerId).toBe(id)
    expect((await signIn(id, '7777')).ok).toBe(true)
    expect((await signIn(id, '1234')).ok).toBe(false)
  })

  it('leaves the old PIN working until the link is used', async () => {
    await link()
    expect((await signIn(id, '1234')).ok).toBe(true)
  })

  it('works once only', async () => {
    const t = await link()
    expect((await redeemPinReset(t, '7777')).ok).toBe(true)
    const again = await redeemPinReset(t, '8888')
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.status).toBe(410)
    expect((await signIn(id, '7777')).ok).toBe(true)
  })

  it('lets exactly one of two simultaneous redemptions win', async () => {
    const t = await link()
    const results = await Promise.all([redeemPinReset(t, '1111'), redeemPinReset(t, '2222')])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
  })

  it('refuses an expired link and leaves the PIN alone', async () => {
    const t = await link()
    await sql`UPDATE managers SET pin_reset_expires = now() - interval '1 minute' WHERE id = ${id}`
    expect((await redeemPinReset(t, '7777')).ok).toBe(false)
    expect((await signIn(id, '1234')).ok).toBe(true)
  })

  it('is replaced by a newer link', async () => {
    const first = await link()
    const second = await link()
    expect((await redeemPinReset(first, '7777')).ok).toBe(false)
    expect((await redeemPinReset(second, '7777')).ok).toBe(true)
  })

  it('stores only a hash of the token, never the token', async () => {
    const t = await link()
    const [row] = await sql`SELECT pin_reset_hash FROM managers WHERE id = ${id}`
    expect(row.pin_reset_hash).toBe(hashResetToken(t))
    expect(row.pin_reset_hash).not.toContain(t)
  })

  it('lifts a lockout', async () => {
    await sql`UPDATE managers SET pin_attempts = 5, pin_locked_until = now() + interval '15 minutes' WHERE id = ${id}`
    expect((await redeemPinReset(await link(), '7777')).ok).toBe(true)
    expect((await signIn(id, '7777')).ok).toBe(true)
  })

  it('gives a seat with no PIN its first one', async () => {
    await sql`UPDATE managers SET pin_hash = NULL WHERE id = ${id}`
    expect((await redeemPinReset(await link(), '4321')).ok).toBe(true)
    const [row] = await sql`SELECT pin_hash FROM managers WHERE id = ${id}`
    expect(await verifyPin('4321', row.pin_hash as string)).toBe(true)
  })

  it('touches only the seat it was issued for', async () => {
    await link(other)
    const t = await link()
    await redeemPinReset(t, '7777')
    expect((await signIn(other, '1234')).ok).toBe(true)
    const [row] = await sql`SELECT pin_reset_hash FROM managers WHERE id = ${other}`
    expect(row.pin_reset_hash).not.toBeNull()
  })

  it('refuses a malformed or unknown token and an unknown manager', async () => {
    expect((await redeemPinReset('nope', '7777')).ok).toBe(false)
    expect((await redeemPinReset('A'.repeat(43), '7777')).ok).toBe(false)
    expect((await issuePinReset(999_999)).ok).toBe(false)
  })
})
