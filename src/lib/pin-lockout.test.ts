import { describe, expect, it } from 'vitest'
import {
  LOCKOUT_MINUTES,
  MAX_PIN_ATTEMPTS,
  lockedMessage,
  minutesUntil,
  wrongPinMessage,
} from './pin-lockout'

const now = new Date('2026-11-11T12:00:00Z')
const at = (ms: number) => new Date(now.getTime() + ms)

describe('pin lockout wording', () => {
  it('is five tries and fifteen minutes', () => {
    expect(MAX_PIN_ATTEMPTS).toBe(5)
    expect(LOCKOUT_MINUTES).toBe(15)
  })

  it('rounds minutes up and never says zero', () => {
    expect(minutesUntil(at(14 * 60_000 + 1), now)).toBe(15)
    expect(minutesUntil(at(60_000), now)).toBe(1)
    expect(minutesUntil(at(1), now)).toBe(1)
    expect(minutesUntil(at(-5000), now)).toBe(1)
  })

  it('pluralises the lock message and points at the commissioner', () => {
    expect(lockedMessage(at(15 * 60_000), now)).toMatch(/15 minutes/)
    expect(lockedMessage(at(30_000), now)).toMatch(/1 minute[,.]/)
    expect(lockedMessage(at(60_000), now)).toMatch(/commissioner/)
  })

  it('counts down the tries left after a wrong PIN', () => {
    expect(wrongPinMessage(1)).toMatch(/4 tries left/)
    expect(wrongPinMessage(4)).toMatch(/1 try left/)
  })
})
