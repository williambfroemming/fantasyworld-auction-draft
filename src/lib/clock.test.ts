import { describe, expect, it } from 'vitest'
import { ClockSync } from './clock'

describe('ClockSync', () => {
  it('reports zero offset before the first sample rather than guessing', () => {
    const c = new ClockSync()
    expect(c.synced).toBe(false)
    expect(c.now(1_000)).toBe(1_000)
  })

  it('corrects a client clock that is 10 minutes fast', () => {
    // The UAT case: someone joins with a badly wrong system clock.
    const TEN_MIN = 10 * 60 * 1000
    const serverNow = 1_000_000
    const clientNow = serverNow + TEN_MIN

    const c = new ClockSync()
    // Converge over a few polls (smoothed, so not instant by design).
    for (let i = 0; i < 60; i++) {
      c.sample({ serverNow, sentAt: clientNow, receivedAt: clientNow })
    }

    // The client thinks it's 10 minutes later; the clock should say otherwise.
    expect(Math.abs(c.now(clientNow) - serverNow)).toBeLessThan(1000)
  })

  it('corrects a client clock that is slow, too', () => {
    const serverNow = 5_000_000
    const clientNow = serverNow - 45_000
    const c = new ClockSync()
    for (let i = 0; i < 60; i++) c.sample({ serverNow, sentAt: clientNow, receivedAt: clientNow })
    expect(Math.abs(c.now(clientNow) - serverNow)).toBeLessThan(1000)
  })

  it('accounts for round-trip latency instead of counting it as skew', () => {
    // Perfectly synced clocks, but a 400ms round trip. The server's timestamp was
    // generated ~200ms into that trip, so a naive implementation would conclude
    // the client is 200ms fast and permanently bias the countdown.
    const sentAt = 1_000_000
    const rtt = 400
    const receivedAt = sentAt + rtt
    const serverNow = sentAt + rtt / 2 // truly in sync

    const c = new ClockSync()
    for (let i = 0; i < 60; i++) c.sample({ serverNow, sentAt, receivedAt })
    expect(Math.abs(c.offsetMs)).toBeLessThan(20)
  })

  it('is not yanked around by a single slow response', () => {
    const c = new ClockSync()
    const base = 1_000_000
    for (let i = 0; i < 40; i++) c.sample({ serverNow: base, sentAt: base, receivedAt: base })
    const before = c.offsetMs

    // One pathological 5-second response.
    c.sample({ serverNow: base, sentAt: base, receivedAt: base + 5000 })
    expect(Math.abs(c.offsetMs - before)).toBeLessThan(600)
  })

  it('accepts an ISO string, which is how endsAt arrives over JSON', () => {
    const c = new ClockSync()
    const now = 1_700_000_000_000
    c.sample({ serverNow: now, sentAt: now, receivedAt: now })
    const iso = new Date(now + 25_000).toISOString()
    expect(c.msUntil(iso, now)).toBe(25_000)
    expect(c.secondsUntil(iso, now)).toBe(25)
  })

  it('returns 0 for an unparseable timestamp rather than NaN', () => {
    // NaN would render as "NaN" on the big countdown, which is worse than 0.
    const c = new ClockSync()
    expect(c.msUntil('not-a-date', 1000)).toBe(0)
  })

  it('counts down and floors at zero, never negative', () => {
    const c = new ClockSync()
    const now = 1_000_000
    c.sample({ serverNow: now, sentAt: now, receivedAt: now })

    expect(c.msUntil(now + 25_000, now)).toBe(25_000)
    expect(c.msUntil(now - 5_000, now)).toBe(0)
  })

  it('rounds displayed seconds up, so "1" shows until the moment it expires', () => {
    const c = new ClockSync()
    const now = 1_000_000
    c.sample({ serverNow: now, sentAt: now, receivedAt: now })

    expect(c.secondsUntil(now + 10_000, now)).toBe(10)
    expect(c.secondsUntil(now + 1, now)).toBe(1) // still ticking
    expect(c.secondsUntil(now, now)).toBe(0) // done
  })

  it('keeps a skewed client and a correct one showing the same countdown', () => {
    // The thing that actually matters: two people in the room see the same number.
    const serverNow = 2_000_000
    const endsAt = serverNow + 20_000

    const good = new ClockSync()
    const skewed = new ClockSync()
    const goodClient = serverNow
    const skewedClient = serverNow + 8 * 60 * 1000

    for (let i = 0; i < 60; i++) {
      good.sample({ serverNow, sentAt: goodClient, receivedAt: goodClient })
      skewed.sample({ serverNow, sentAt: skewedClient, receivedAt: skewedClient })
    }

    expect(
      Math.abs(good.secondsUntil(endsAt, goodClient) - skewed.secondsUntil(endsAt, skewedClient)),
    ).toBeLessThanOrEqual(1)
  })
})
