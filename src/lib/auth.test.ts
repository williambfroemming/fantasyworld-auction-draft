import { describe, expect, it } from 'vitest'
import { hashPin, isValidPinFormat, signSession, verifyPin, verifySession } from './auth'

const SECRET = 'test-secret'

describe('PIN hashing', () => {
  it('accepts the correct PIN and rejects a wrong one', async () => {
    const stored = await hashPin('1234')
    expect(await verifyPin('1234', stored)).toBe(true)
    expect(await verifyPin('1235', stored)).toBe(false)
  })

  it('salts, so the same PIN hashes differently for two managers', async () => {
    expect(await hashPin('0000')).not.toBe(await hashPin('0000'))
  })

  it('never stores the PIN in the clear', async () => {
    expect(await hashPin('4321')).not.toContain('4321')
  })

  it('rejects cleanly when no PIN has been set yet', async () => {
    expect(await verifyPin('1234', null)).toBe(false)
  })

  it('rejects malformed stored values instead of throwing', async () => {
    expect(await verifyPin('1234', 'garbage')).toBe(false)
    expect(await verifyPin('1234', 'nosalt:')).toBe(false)
    // A hash of the wrong length must not blow up timingSafeEqual.
    expect(await verifyPin('1234', 'abcd:00ff')).toBe(false)
  })

  it('requires exactly 4 digits', () => {
    expect(isValidPinFormat('1234')).toBe(true)
    expect(isValidPinFormat('123')).toBe(false)
    expect(isValidPinFormat('12345')).toBe(false)
    expect(isValidPinFormat('12a4')).toBe(false)
    expect(isValidPinFormat('')).toBe(false)
  })
})

describe('session cookie', () => {
  it('round-trips a manager id', () => {
    expect(verifySession(signSession(7, SECRET), SECRET)).toBe(7)
  })

  it('rejects a tampered manager id — nobody can bid as someone else', () => {
    const token = signSession(7, SECRET)
    const forged = token.replace(/^7\./, '8.')
    expect(verifySession(forged, SECRET)).toBeNull()
  })

  it('rejects a token signed with a different secret', () => {
    expect(verifySession(signSession(7, 'other-secret'), SECRET)).toBeNull()
  })

  it('rejects junk and missing tokens', () => {
    expect(verifySession(undefined, SECRET)).toBeNull()
    expect(verifySession('', SECRET)).toBeNull()
    expect(verifySession('no-dot', SECRET)).toBeNull()
    expect(verifySession('.', SECRET)).toBeNull()
    expect(verifySession('abc.def', SECRET)).toBeNull()
  })

  it('rejects a valid signature over a non-positive id', () => {
    expect(verifySession(signSession(0, SECRET), SECRET)).toBeNull()
    expect(verifySession(signSession(-1, SECRET), SECRET)).toBeNull()
  })
})
