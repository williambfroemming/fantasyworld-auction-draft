import { describe, expect, it } from 'vitest'
import { rosterOrigin, type OriginPick, type OriginRow } from './roster-origin'
import type { StatsTrade } from './stats'

const S = 2025
const keys = new Set([`${S}:1`, `${S}:2`])
const row = (
  managerId: number,
  playerId: string,
  points: number,
  week = 1,
  isStarter = true,
): OriginRow => ({
  season: S,
  week,
  managerId,
  playerId,
  isStarter,
  points,
})
const pick = (id: number, managerId: number, sleeperId: string | null, season = S): OriginPick => ({
  id,
  season,
  managerId,
  sleeperId,
})
// Pick 2 was bought by manager 1 and traded to manager 2 (current owner 2).
const trade: StatsTrade = {
  id: 1,
  createdAt: '2025-08-01T00:00:00Z',
  managerAId: 1,
  managerBId: 2,
  players: [{ pickId: 2, toManagerId: 2 }],
}

describe('rosterOrigin', () => {
  const picks = [pick(1, 1, 'a'), pick(2, 2, 'b')]
  const rows = [
    row(1, 'a', 10),
    row(2, 'b', 7),
    row(2, 'z', 3),
    row(1, 'a', 5, 2),
    row(1, 'b', 99, 1, false),
  ]
  const out = rosterOrigin(rows, picks, [trade], S, keys)
  const m = (id: number) => out.find((r) => r.managerId === id)!

  it('puts bought players in drafted', () => {
    expect(m(1).drafted).toBe(15)
  })
  it("puts a traded player's points with the new owner as tradedAtDraft", () => {
    expect(m(2).tradedAtDraft).toBe(7)
    expect(m(2).drafted).toBe(0)
  })
  it('puts a player on no pick of theirs in addedLater', () => {
    expect(m(2).addedLater).toBe(3)
  })
  it('counts only started rows', () => {
    expect(m(1).total).toBe(15)
  })
  it('the four parts sum to the started total', () => {
    for (const r of out)
      expect(r.drafted + r.tradedAtDraft + r.addedLater + r.unknown).toBeCloseTo(r.total, 9)
  })
  it('does not call a rival who claimed a dropped player "traded"', () => {
    // Manager 3 started player a, whom manager 1 bought; no trade moved him.
    const o = rosterOrigin([row(3, 'a', 4)], picks, [trade], S, keys)
    expect(o[0].addedLater).toBe(4)
    expect(o[0].tradedAtDraft).toBe(0)
  })
  it('reports an unmatched pick as unknown, not addedLater', () => {
    const p = [pick(1, 1, null), pick(2, 2, 'b')]
    const o = rosterOrigin([row(1, 'q', 6), row(2, 'z', 2)], p, [], S, keys)
    expect(o.find((r) => r.managerId === 1)!.unknown).toBe(6)
    expect(o.find((r) => r.managerId === 1)!.addedLater).toBe(0)
    // A manager with no unresolvable pick is not tainted.
    expect(o.find((r) => r.managerId === 2)!.addedLater).toBe(2)
  })
  it('ignores weeks outside the key set and other seasons', () => {
    const o = rosterOrigin(
      [row(1, 'a', 10, 9), { ...row(1, 'a', 10), season: 2024 }],
      picks,
      [],
      S,
      keys,
    )
    expect(o).toEqual([])
  })
  it("ignores another season's picks", () => {
    const o = rosterOrigin([row(1, 'a', 10)], [pick(1, 1, 'a', 2024)], [], S, keys)
    expect(o[0].drafted).toBe(0)
    expect(o[0].addedLater).toBe(10)
  })
})
