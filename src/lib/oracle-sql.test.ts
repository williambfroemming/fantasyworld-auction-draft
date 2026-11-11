import { describe, expect, it } from 'vitest'
import { MAX_SQL_LENGTH, ROW_LIMIT, guardSql } from './oracle-sql'

const rejected = (input: string) => {
  const r = guardSql(input)
  expect(r.ok).toBe(false)
  return r.ok ? '' : r.reason
}

describe('guardSql — accepts', () => {
  it('passes a plain SELECT and wraps it with the row limit plus one', () => {
    const r = guardSql('SELECT name FROM managers')
    expect(r).toEqual({
      ok: true,
      sql: `SELECT * FROM (SELECT name FROM managers) AS oracle_q LIMIT ${ROW_LIMIT + 1}`,
    })
    expect(ROW_LIMIT).toBe(200)
  })

  it('passes a WITH … SELECT', () => {
    expect(guardSql('WITH t AS (SELECT 1 AS n) SELECT n FROM t').ok).toBe(true)
  })

  it('passes mixed case', () => {
    expect(guardSql('SeLeCt 1').ok).toBe(true)
    expect(guardSql('wItH t AS (SELECT 1) SELECT * FROM t').ok).toBe(true)
  })

  it('strips exactly one trailing semicolon and surrounding whitespace', () => {
    const r = guardSql('  SELECT 1 ;  ')
    expect(r).toEqual({
      ok: true,
      sql: `SELECT * FROM (SELECT 1) AS oracle_q LIMIT ${ROW_LIMIT + 1}`,
    })
  })

  it('does not trip the whole-word rules on column names containing keywords', () => {
    // created_at ⊃ create, injury_updated_at ⊃ update, is_final / dropped_passes etc.
    expect(guardSql('SELECT created_at, injury_updated_at FROM draft_trades').ok).toBe(true)
    expect(guardSql('SELECT deleted_flag, called_it, copyright, merger FROM games').ok).toBe(true)
  })
})

describe('guardSql — rejects', () => {
  it('empty input, and input that is only a semicolon', () => {
    expect(rejected('')).toMatch(/empty/i)
    expect(rejected('   ')).toMatch(/empty/i)
    expect(rejected(' ; ')).toMatch(/empty/i)
  })

  it('input longer than 4,000 characters', () => {
    const long = 'SELECT ' + '1,'.repeat(MAX_SQL_LENGTH) + '1'
    expect(rejected(long)).toMatch(/longer than/i)
  })

  it('a remaining semicolon (two statements)', () => {
    expect(rejected('SELECT 1; SELECT 2')).toMatch(/semicolon/i)
    expect(rejected('SELECT 1;; ')).toMatch(/semicolon/i)
  })

  it('a semicolon inside a string literal (accepted over-rejection)', () => {
    expect(rejected("SELECT 'a;b' AS x")).toMatch(/semicolon/i)
  })

  it('line comments and block comments', () => {
    expect(rejected('SELECT 1 -- hi')).toMatch(/comment/i)
    expect(rejected('SELECT /* hi */ 1')).toMatch(/comment/i)
  })

  it('anything that does not start with select or with', () => {
    expect(rejected('EXPLAIN SELECT 1')).toMatch(/start with/i)
    expect(rejected('SHOW all')).toMatch(/start with/i)
    expect(rejected('(SELECT 1)')).toMatch(/start with/i)
    expect(rejected('selected 1')).toMatch(/start with/i)
  })

  it.each([
    'insert',
    'update',
    'delete',
    'merge',
    'truncate',
    'drop',
    'alter',
    'create',
    'grant',
    'revoke',
    'copy',
    'call',
  ])('the word %s, in any case', (word) => {
    expect(rejected(`WITH x AS (${word.toUpperCase()} stuff) SELECT * FROM x`)).toMatch(
      new RegExp(`"${word}"`),
    )
    expect(rejected(`SELECT 1 FROM games WHERE ${word} = 1`)).toMatch(new RegExp(`"${word}"`))
  })

  it('a data-modifying CTE', () => {
    expect(rejected('WITH x AS (DELETE FROM games RETURNING 1) SELECT * FROM x')).toMatch(/delete/)
  })

  it('pg_ (catalogs and functions)', () => {
    expect(rejected('SELECT * FROM pg_catalog.pg_roles')).toMatch(/pg_/)
    expect(rejected('SELECT pg_sleep(10)')).toMatch(/pg_/)
  })

  it('information_schema', () => {
    expect(rejected('SELECT * FROM information_schema.columns')).toMatch(/information_schema/)
  })

  it('set_config', () => {
    expect(rejected("SELECT set_config('role', 'postgres', false)")).toMatch(/set_config/)
  })

  it('public. qualification, in any case', () => {
    expect(rejected('SELECT * FROM public.player_queue')).toMatch(/public\./)
    expect(rejected('SELECT * FROM PUBLIC.managers')).toMatch(/public\./)
  })
})
