/**
 * The Oracle's runner, against a REAL Postgres database.
 *
 * Same guards as the other integration suites (see queue-service.itest.ts). Nothing
 * here writes — the point is that nothing CAN — but the suite follows the convention so
 * it only ever runs through `npm run test:int` against the test database.
 *
 * Needs `npm run db:local:setup-test` and `db:migrate-oracle -- --test` first: the
 * migration is what creates the role and the views.
 *
 * ⚠️ Assertions on refusals check THAT a query was refused, never the wording. Postgres
 * says "permission denied for schema public" on a freshly bootstrapped local database
 * and "…for table player_queue" on Neon.
 */
import { describe, expect, it } from 'vitest'
import { getSql } from './sql'
import { runOracleQuery } from './oracle-service'

const ENABLED = process.env.ALLOW_DB_RESET === '1' && !!process.env.DATABASE_URL
const d = ENABLED ? describe : describe.skip

d('oracle-service (real Postgres)', () => {
  it('reads the managers view and exposes only manager_id and name', async () => {
    const r = await runOracleQuery('SELECT * FROM managers')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.columns).toEqual(['manager_id', 'name'])
    expect(r.truncated).toBe(false)
    for (const row of r.rows) expect(row).toHaveLength(2)
  })

  it('refuses a read of player_queue', async () => {
    expect((await runOracleQuery('SELECT * FROM player_queue')).ok).toBe(false)
    expect((await runOracleQuery('SELECT * FROM public.player_queue')).ok).toBe(false)
  })

  it('refuses a read of page_visits (commissioner-only activity)', async () => {
    expect((await runOracleQuery('SELECT * FROM page_visits')).ok).toBe(false)
    expect((await runOracleQuery('SELECT * FROM public.page_visits')).ok).toBe(false)
  })

  it('refuses pin_hash', async () => {
    expect((await runOracleQuery('SELECT pin_hash FROM managers')).ok).toBe(false)
  })

  it('refuses the tables the Oracle must never see, by bare name', async () => {
    for (const t of ['draft', 'lots', 'budget_adjustments', 'oracle_log', 'week_issues', 'picks']) {
      const r = await runOracleQuery(`SELECT * FROM ${t}`)
      expect(r.ok, t).toBe(false)
    }
  })

  it('refuses a data-modifying CTE — in the guard, and again in the database', async () => {
    const attack = 'WITH x AS (DELETE FROM games RETURNING 1) SELECT * FROM x'
    expect((await runOracleQuery(attack)).ok).toBe(false)

    // Bypass the guard: send the wrapped text straight to the batch. The database
    // alone must still say no.
    const sql = getSql()
    await expect(
      sql.transaction(
        [
          sql.query('SET LOCAL ROLE oracle_reader'),
          sql.query('SET LOCAL search_path = oracle'),
          sql.query(`SELECT * FROM (${attack}) AS oracle_q LIMIT 201`),
        ],
        { readOnly: true, fullResults: true },
      ),
    ).rejects.toThrow()
  })

  it('refuses a write that skips the read-only flag, because the role itself cannot write', async () => {
    const sql = getSql()
    await expect(
      sql.transaction(
        [sql.query('SET LOCAL ROLE oracle_reader'), sql.query('CREATE TABLE oracle.x (a int)')],
        { readOnly: false },
      ),
    ).rejects.toThrow()
  })

  it('cancels a runaway query as a timeout, in under ten seconds', async () => {
    const t0 = Date.now()
    const r = await runOracleQuery('SELECT count(*) FROM generate_series(1, 100000000000)')
    expect(Date.now() - t0).toBeLessThan(10_000)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/timeout/i)
  })

  it('caps rows at 200 and says so', async () => {
    const r = await runOracleQuery('SELECT n FROM generate_series(1, 500) AS n')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.rows).toHaveLength(200)
    expect(r.truncated).toBe(true)
  })

  it('does not call exactly 200 rows truncated', async () => {
    const r = await runOracleQuery('SELECT n FROM generate_series(1, 200) AS n')
    expect(r.ok && r.rows.length === 200 && !r.truncated).toBe(true)
  })

  it('returns the database message for broken SQL instead of throwing', async () => {
    const r = await runOracleQuery('SELECT nope FROM managers')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/nope/)
  })
})
