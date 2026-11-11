import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ORACLE_RULES, ORACLE_VIEWS, oracleSchemaText } from './oracle-schema'

/**
 * Parse the VIEWS table out of scripts/migrate-oracle.ts as text. The script runs its
 * migration on import, so it cannot be imported here; and it builds the view name from a
 * template (oracle.${v.name}), so a search for "CREATE OR REPLACE VIEW oracle.<name>"
 * finds nothing. The entries themselves are the source of truth.
 */
function migrationViews(): Array<{ name: string; columns: string[] }> {
  const text = readFileSync(join(__dirname, '../../scripts/migrate-oracle.ts'), 'utf8')
  const out: Array<{ name: string; columns: string[] }> = []
  const re = /name: '(\w+)',\s*from: '[^']+',\s*select: [`']([\s\S]*?)[`'],/g
  for (const m of text.matchAll(re)) {
    const columns = m[2]
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
      // "player_team AS nfl_team" -> nfl_team; a bare column is its own name.
      .map((c) => c.split(/\s+/).pop()!)
    out.push({ name: m[1], columns })
  }
  return out
}

describe('oracle schema notes', () => {
  it('parses the migration (guards the parser itself)', () => {
    expect(migrationViews().length).toBe(11)
  })

  it('names exactly the views the migration creates', () => {
    expect(ORACLE_VIEWS.map((v) => v.name).sort()).toEqual(
      migrationViews()
        .map((v) => v.name)
        .sort(),
    )
  })

  it('lists exactly the columns each view exposes, in order', () => {
    for (const mv of migrationViews()) {
      const note = ORACLE_VIEWS.find((v) => v.name === mv.name)
      expect(note?.columns, mv.name).toEqual(mv.columns)
    }
  })

  it('every view has a note', () => {
    for (const v of ORACLE_VIEWS) expect(v.note.length, v.name).toBeGreaterThan(20)
  })

  it('never mentions anything private', () => {
    const everything = `${oracleSchemaText()}\n${ORACLE_RULES}`.toLowerCase()
    for (const word of [
      'player_queue',
      'pin_hash',
      'week_issues',
      'lots',
      'budget_adjustments',
      'oracle_log',
    ]) {
      expect(everything, word).not.toContain(word)
    }
  })

  it('contains no backticks (they would break the prompt template)', () => {
    expect(`${oracleSchemaText()}${ORACLE_RULES}`).not.toContain('`')
  })

  it('states the scope rules the model must repeat', () => {
    expect(ORACLE_RULES).toContain('while rostered in this league, since 2020')
    expect(ORACLE_RULES).toMatch(/two rows per game/i)
    expect(ORACLE_RULES).toMatch(/null means unknown/i)
    expect(ORACLE_RULES).toMatch(/within a position/i)
  })
})
