import { afterEach, describe, expect, it } from 'vitest'
import { readDatabaseUrl } from './sql'

const URL_ = 'postgresql://user:pw@ep-x.aws.neon.tech/neondb?sslmode=require'
const original = process.env.DATABASE_URL

afterEach(() => {
  if (original === undefined) delete process.env.DATABASE_URL
  else process.env.DATABASE_URL = original
})

describe('readDatabaseUrl', () => {
  it('returns a clean connection string untouched', () => {
    process.env.DATABASE_URL = URL_
    expect(readDatabaseUrl()).toBe(URL_)
  })

  /**
   * The regression this exists for, and the reason it cost two failed runs.
   *
   * `neon()` parses with `new URL()`, which strips *trailing* C0 whitespace and
   * not *leading*. So a secret with a newline on the end works and the identical
   * secret with one on the front throws "not a valid URL", naming a value nobody
   * can print to compare against. Both are trivially easy to store by accident.
   */
  it('strips a LEADING newline, which is the one that actually threw', () => {
    process.env.DATABASE_URL = `\n${URL_}`
    expect(readDatabaseUrl()).toBe(URL_)
  })

  it('strips a trailing newline, which neon tolerated anyway', () => {
    process.env.DATABASE_URL = `${URL_}\n`
    expect(readDatabaseUrl()).toBe(URL_)
  })

  it('strips CRLF and surrounding spaces', () => {
    process.env.DATABASE_URL = `\r\n  ${URL_}  \r\n`
    expect(readDatabaseUrl()).toBe(URL_)
  })

  it('throws when unset', () => {
    delete process.env.DATABASE_URL
    expect(() => readDatabaseUrl()).toThrow(/not set/)
  })

  it('distinguishes "set but whitespace" from "not set at all"', () => {
    // Worth its own message: a whitespace-only secret is non-empty, so every
    // `-z` guard upstream passes it through and the failure surfaces much
    // later, somewhere that cannot say what it received.
    process.env.DATABASE_URL = '   \n'
    expect(() => readDatabaseUrl()).toThrow(/set but empty/)
  })
})
