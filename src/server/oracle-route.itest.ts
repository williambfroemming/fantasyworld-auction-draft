/**
 * The Oracle's cap and log, against a REAL Postgres database. Same guards as the other
 * integration suites. Needs `db:migrate-oracle -- --test` first.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getSql } from './sql'
import { logQuestion, questionsToday, runOracleQuery, type OracleResult } from './oracle-service'

const ENABLED = process.env.ALLOW_DB_RESET === '1' && !!process.env.DATABASE_URL
const d = ENABLED ? describe : describe.skip

const result = (over: Partial<OracleResult> = {}): OracleResult => ({
  ok: true,
  answer: 'Ten.',
  steps: [],
  error: null,
  inputTokens: 100,
  outputTokens: 20,
  ...over,
})

d('oracle cap and log (real Postgres)', () => {
  const sql = getSql()
  let a = 0
  let b = 0

  beforeAll(async () => {
    const m = (await sql`SELECT id FROM managers ORDER BY draft_slot LIMIT 2`) as Array<{ id: number }>
    a = m[0].id
    b = m[1].id
  })
  beforeEach(async () => {
    await sql`DELETE FROM oracle_log`
  })
  afterAll(async () => {
    await sql`DELETE FROM oracle_log`
  })

  it('counts only the caller\'s questions', async () => {
    await logQuestion(a, 'one', result(), 5)
    await logQuestion(a, 'two', result({ ok: false, answer: null, error: 'boom' }), 5)
    await logQuestion(b, 'three', result(), 5)
    expect((await questionsToday(a)).count).toBe(2) // failed ones count: they cost tokens
    expect((await questionsToday(b)).count).toBe(1)
  })

  it('does not count questions older than 24 hours, and says when the oldest frees up', async () => {
    await logQuestion(a, 'old', result(), 5)
    await sql`UPDATE oracle_log SET created_at = now() - interval '25 hours'`
    await logQuestion(a, 'recent', result(), 5)
    const u = await questionsToday(a)
    expect(u.count).toBe(1)
    expect(u.freesAt!.getTime()).toBeGreaterThan(Date.now() + 23 * 3600_000)
    expect((await questionsToday(b)).freesAt).toBeNull()
  })

  it('stores a retrievable row with the steps, trimmed to 20 rows each', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => [i])
    const id = await logQuestion(
      a,
      'how many?',
      result({
        steps: [{ sql: 'SELECT 1', ok: true, columns: ['n'], rows, truncated: false, error: null, ms: 4 }],
      }),
      1234,
    )
    const [row] = await sql`SELECT * FROM oracle_log WHERE id = ${id}`
    expect(row).toMatchObject({
      manager_id: a,
      question: 'how many?',
      answer: 'Ten.',
      ok: true,
      error: null,
      ms: 1234,
      input_tokens: 100,
      output_tokens: 20,
    })
    expect(row.steps).toHaveLength(1)
    expect(row.steps[0].sql).toBe('SELECT 1')
    expect(row.steps[0].rows).toHaveLength(20)
  })

  it('is NOT readable through the Oracle', async () => {
    await logQuestion(a, 'secret question', result(), 1)
    for (const q of ['SELECT * FROM oracle_log', 'SELECT * FROM public.oracle_log']) {
      expect((await runOracleQuery(q)).ok, q).toBe(false)
    }
  })
})
