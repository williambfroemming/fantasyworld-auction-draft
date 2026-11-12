import { describe, expect, it } from 'vitest'
import { MAX_EXAMPLE_LENGTH, ORACLE_EXAMPLES } from './oracle-examples'

describe('the Oracle example chips', () => {
  it('has a handful of them', () => {
    expect(ORACLE_EXAMPLES.length).toBeGreaterThanOrEqual(6)
    expect(ORACLE_EXAMPLES.length).toBeLessThanOrEqual(10)
  })

  it('every chip is a plain, short question', () => {
    for (const q of ORACLE_EXAMPLES) {
      expect(typeof q).toBe('string')
      expect(q.length, q).toBeLessThanOrEqual(MAX_EXAMPLE_LENGTH)
      expect(q.endsWith('?'), q).toBe(true)
      expect(q).not.toMatch(/[`*_#\\[\\]]/)
    }
  })

  it('has no duplicates', () => {
    expect(new Set(ORACLE_EXAMPLES).size).toBe(ORACLE_EXAMPLES.length)
  })

  it('covers points, stat lines and waivers', () => {
    const all = ORACLE_EXAMPLES.join(' ').toLowerCase()
    expect(all).toMatch(/yards/)
    expect(all).toMatch(/faab|waiver/)
    expect(all).toMatch(/points|started|paid/)
  })

  it('never asks a stat question across positions', () => {
    // A stat question must name a position or a player. "Most yards, all positions" is the
    // question the site is built not to answer.
    for (const q of ORACLE_EXAMPLES.filter((x) => /yards/i.test(x))) {
      expect(q, q).toMatch(
        /receiver|running back|quarterback|tight end|defense|[A-Z][a-z]+ [A-Z][a-z]+/,
      )
    }
  })
})
