import { describe, expect, it } from 'vitest'
import { memberRosterOrigin, rosterOrigin, visibleParts, type OriginPick, type OriginRow } from './roster-origin'
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

describe('visibleParts and memberRosterOrigin', () => {
  const r = (managerId: number, d: number, t: number, a: number, u = 0) => ({
    managerId, drafted: d, tradedAtDraft: t, addedLater: a, waiver: 0, freeAgent: 0, tradedLater: 0,
    otherAdded: 0, unknown: u, total: d + t + a + u,
  })
  it('drops a part that is zero for everyone, keeps drafted and the unsplit added-later', () => {
    expect(visibleParts([r(1, 0, 0, 0), r(2, 5, 0, 5)])).toEqual(['drafted', 'addedLater'])
  })
  it('draws the split INSTEAD of added-later, never both', () => {
    const split = { ...r(1, 5, 0, 6), waiver: 4, freeAgent: 2 }
    const parts = visibleParts([split])
    expect(parts).toEqual(['drafted', 'waiver', 'freeAgent'])
    expect(parts).not.toContain('addedLater')
  })
  it('keeps a part any manager has', () => {
    expect(visibleParts([r(1, 5, 2, 1), r(2, 5, 0, 5)])).toContain('tradedAtDraft')
  })
  it("returns one manager's seasons newest first and skips seasons without them", () => {
    const out = memberRosterOrigin(
      [
        { season: 2021, rows: [r(1, 1, 0, 1)] },
        { season: 2023, rows: [r(1, 2, 0, 2)] },
        { season: 2022, rows: [r(2, 3, 0, 3)] },
      ],
      1,
    )
    expect(out.map((o) => o.season)).toEqual([2023, 2021])
  })
})

describe('splitting added-later with transactions', () => {
  const acq = (managerId: number, playerId: string, week: number, kind: 'waiver' | 'free_agent' | 'trade' | 'commissioner') => ({
    season: S, week, managerId, playerId, kind,
  })
  const picks = [pick(1, 1, 'a')]
  const rows = [
    row(1, 'w', 10, 1), row(1, 'w', 10, 2), // claimed in week 1 (filed under 1, plays 2)
    row(1, 'f', 4, 2), // free agent
    row(1, 't', 3, 2), // traded for
    row(1, 'c', 2, 2), // commissioner
    row(1, 'z', 1, 2), // no add on record
    row(1, 'a', 20, 2), // drafted
  ]
  const a = [acq(1, 'w', 1, 'waiver'), acq(1, 'f', 1, 'free_agent'), acq(1, 't', 1, 'trade'), acq(1, 'c', 1, 'commissioner')]
  const m = rosterOrigin(rows, picks, [], S, keys, a)[0]

  it('splits by how the player was added', () => {
    expect(m).toMatchObject({ drafted: 20, waiver: 20, freeAgent: 4, tradedLater: 3, otherAdded: 3 })
  })
  it('the split always adds up to added-later, and the whole still adds up to the total', () => {
    expect(m.waiver + m.freeAgent + m.tradedLater + m.otherAdded).toBeCloseTo(m.addedLater, 9)
    expect(m.drafted + m.tradedAtDraft + m.addedLater + m.unknown).toBeCloseTo(m.total, 9)
  })
  it('without transactions it leaves the split at zero and added-later whole', () => {
    const plain = rosterOrigin(rows, picks, [], S, keys)[0]
    expect(plain.addedLater).toBe(m.addedLater)
    expect([plain.waiver, plain.freeAgent, plain.tradedLater, plain.otherAdded]).toEqual([0, 0, 0, 0])
  })
  it('credits a player to the LATEST add before the week', () => {
    const later = rosterOrigin(
      [row(1, 'x', 5, 6)],
      picks, [], S, new Set([`${S}:6`]),
      [acq(1, 'x', 1, 'waiver'), acq(1, 'x', 4, 'free_agent')],
    )[0]
    expect(later.freeAgent).toBe(5)
    expect(later.waiver).toBe(0)
  })
})
