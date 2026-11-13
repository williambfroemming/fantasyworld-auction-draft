import { describe, expect, it } from 'vitest'
import { hashResetToken, isResetTokenFormat, newResetToken, signPayload, signSession, verifyPayload } from '@/lib/auth'
import { containsCode, newChallengeCode } from './provider'
import { leagueUserHasCode, normalizeUsername } from './sleeper'

const SECRET = 'test-secret'

describe('signed challenge payloads', () => {
  const payload = { kind: 'join-challenge', userId: '123', code: 'FW-0042', exp: 2_000 }

  it('round-trips while unexpired', () => {
    expect(verifyPayload(signPayload(payload, SECRET), SECRET, 1_000)).toEqual(payload)
  })

  it('refuses an expired one', () => {
    expect(verifyPayload(signPayload(payload, SECRET), SECRET, 2_000)).toBeNull()
  })

  it('refuses a payload edited after signing — the swap that would prove someone else', () => {
    const [, sig] = signPayload(payload, SECRET).split('.')
    const edited = Buffer.from(JSON.stringify({ ...payload, userId: '999' })).toString('base64url')
    expect(verifyPayload(`${edited}.${sig}`, SECRET, 1_000)).toBeNull()
  })

  it('refuses another secret, garbage, and a session cookie passed off as a payload', () => {
    expect(verifyPayload(signPayload(payload, SECRET), 'other', 1_000)).toBeNull()
    expect(verifyPayload('not-a-token', SECRET, 1_000)).toBeNull()
    expect(verifyPayload('.', SECRET, 1_000)).toBeNull()
    expect(verifyPayload(signSession(4, SECRET), SECRET, 1_000)).toBeNull()
  })
})

describe('reset tokens', () => {
  it('are 43 url-safe characters, unique, and hash deterministically', () => {
    const a = newResetToken()
    const b = newResetToken()
    expect(isResetTokenFormat(a)).toBe(true)
    expect(a).not.toBe(b)
    expect(hashResetToken(a)).toBe(hashResetToken(a))
    expect(hashResetToken(a)).not.toBe(hashResetToken(b))
    expect(hashResetToken(a)).not.toContain(a)
  })

  it('reject anything that is not one', () => {
    expect(isResetTokenFormat('')).toBe(false)
    expect(isResetTokenFormat('a'.repeat(42))).toBe(false)
    expect(isResetTokenFormat(`${'a'.repeat(42)}/`)).toBe(false)
  })
})

describe('challenge codes', () => {
  it('look like FW-0000', () => {
    expect(newChallengeCode(() => 0)).toBe('FW-0000')
    expect(newChallengeCode(() => 0.9999)).toBe('FW-9999')
    expect(newChallengeCode()).toMatch(/^FW-\d{4}$/)
  })

  it('match ignoring case and spaces, anywhere in the name', () => {
    expect(containsCode('Median Karma fw-0042', 'FW-0042')).toBe(true)
    expect(containsCode('FW - 0042 Lads', 'FW-0042')).toBe(true)
    expect(containsCode('Median Karma', 'FW-0042')).toBe(false)
    expect(containsCode('FW-0043', 'FW-0042')).toBe(false)
    expect(containsCode(undefined, 'FW-0042')).toBe(false)
  })
})

describe('Sleeper team-name check', () => {
  const users = [
    { user_id: '597851820731203584', display_name: 'gizzle4', metadata: { team_name: 'Grossman FW-1111' } },
    { user_id: '612336986497318912', display_name: 'markcubs', metadata: { team_name: 'Mark' } },
    { user_id: '482305993246502912', display_name: 'blinton2' },
  ]

  it('passes only for the account whose OWN team name carries the code', () => {
    expect(leagueUserHasCode(users, '597851820731203584', 'FW-1111')).toBe(true)
    // the co-owner of the same roster has his own team name, and must prove with it
    expect(leagueUserHasCode(users, '612336986497318912', 'FW-1111')).toBe(false)
  })

  it('fails for someone not in the league, or with no team name set', () => {
    expect(leagueUserHasCode(users, 'stranger', 'FW-1111')).toBe(false)
    expect(leagueUserHasCode(users, '482305993246502912', 'FW-1111')).toBe(false)
  })

  it('takes a username as people type it', () => {
    expect(normalizeUsername('  @blinton2 ')).toBe('blinton2')
  })
})
