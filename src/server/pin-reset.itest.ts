/**
 * The commissioner's PIN reset, against a REAL Postgres database. Same guards as the
 * other integration suites.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { verifyPin } from '@/lib/auth'
import { resetPin } from './commish-service'
import { getSql } from './sql'

const ENABLED = process.env.ALLOW_DB_RESET === '1' && !!process.env.DATABASE_URL
const d = ENABLED ? describe : describe.skip

d('resetPin (real Postgres)', () => {
  const sql = getSql()
  let id = 0

  beforeAll(async () => {
    id = ((await sql`SELECT id FROM managers ORDER BY draft_slot LIMIT 1`) as Array<{ id: number }>)[0].id
  })
  afterAll(async () => {
    await sql`UPDATE managers SET pin_hash = NULL`
  })

  it('sets a working four-digit PIN and returns it, even for a seat with no PIN', async () => {
    await sql`UPDATE managers SET pin_hash = NULL WHERE id = ${id}`
    const r = await resetPin(id)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.pin).toMatch(/^\d{4}$/)
    const [row] = await sql`SELECT pin_hash FROM managers WHERE id = ${id}`
    expect(await verifyPin(r.data.pin, row.pin_hash as string)).toBe(true)
  })

  it('replaces the old PIN: the previous one stops working', async () => {
    const first = await resetPin(id)
    let second = await resetPin(id)
    // 1-in-10,000 collision; retry once rather than flake.
    if (first.ok && second.ok && first.data.pin === second.data.pin) second = await resetPin(id)
    if (!first.ok || !second.ok) throw new Error('reset failed')
    const [row] = await sql`SELECT pin_hash FROM managers WHERE id = ${id}`
    expect(await verifyPin(second.data.pin, row.pin_hash as string)).toBe(true)
    expect(await verifyPin(first.data.pin, row.pin_hash as string)).toBe(false)
  })

  it('refuses an unknown manager', async () => {
    expect((await resetPin(999_999)).ok).toBe(false)
  })

  it('touches only the one seat', async () => {
    await sql`UPDATE managers SET pin_hash = NULL`
    await resetPin(id)
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM managers WHERE pin_hash IS NOT NULL`
    expect(n).toBe(1)
  })
})
