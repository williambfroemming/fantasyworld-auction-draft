import { describe, expect, it } from 'vitest'
import { draftDna, type DnaPick } from './draft-dna'
import type { StatsTrade } from './stats'

let nextId = 1
const pick = (
  season: number,
  pickNo: number,
  managerId: number,
  position: string,
  price: number,
  points: number | null = null,
): DnaPick => ({
  id: nextId++,
  season,
  pickNo,
  managerId,
  name: `${position}${nextId}`,
  position,
  price,
  points,
})

const trade = (
  id: number,
  managerAId: number,
  managerBId: number,
  players: Array<{ pickId: number; toManagerId: number }>,
): StatsTrade => ({
  id,
  createdAt: `2026-09-0${id}T00:00:00.000Z`,
  managerAId,
  managerBId,
  players,
})

describe('draftDna', () => {
  it('splits a season by position and the shares total 1', () => {
    const picks = [
      pick(2026, 1, 1, 'QB', 60),
      pick(2026, 2, 1, 'RB', 30),
      pick(2026, 3, 1, 'WR', 8),
      pick(2026, 4, 1, 'K', 2),
    ]
    const { seasons } = draftDna(picks, [], 1)
    const s = seasons[0]

    expect(s.spent).toBe(100)
    expect(s.positionShare.QB).toBeCloseTo(0.6)
    expect(s.positionShare.RB).toBeCloseTo(0.3)
    expect(s.positionShare.WR).toBeCloseTo(0.08)
    // Kickers fold into OTHER rather than being dropped, so the row still adds
    // up to what was actually spent.
    expect(s.positionShare.OTHER).toBeCloseTo(0.02)
    expect(Object.values(s.positionShare).reduce((a, b) => a + b, 0)).toBeCloseTo(1)
  })

  it('reads stars-and-scrubs off the top-3 share and the $1 count', () => {
    const barbell = [
      pick(2026, 1, 1, 'QB', 70),
      pick(2026, 2, 1, 'RB', 60),
      pick(2026, 3, 1, 'WR', 60),
      pick(2026, 4, 1, 'WR', 1),
      pick(2026, 5, 1, 'TE', 1),
      pick(2026, 6, 1, 'RB', 1),
    ]
    const spread = [
      pick(2026, 1, 2, 'QB', 35),
      pick(2026, 2, 2, 'RB', 33),
      pick(2026, 3, 2, 'WR', 32),
      pick(2026, 4, 2, 'WR', 30),
      pick(2026, 5, 2, 'TE', 30),
      pick(2026, 6, 2, 'RB', 33),
    ]
    const all = [...barbell, ...spread]

    expect(draftDna(all, [], 1).seasons[0].topThreeShare).toBeCloseTo(190 / 193)
    expect(draftDna(all, [], 1).seasons[0].dollarPicks).toBe(3)
    expect(draftDna(all, [], 2).seasons[0].topThreeShare).toBeCloseTo(101 / 193)
    expect(draftDna(all, [], 2).seasons[0].dollarPicks).toBe(0)
  })

  it('finds the pick they were half done spending by', () => {
    const picks = [
      pick(2026, 1, 1, 'QB', 50),
      pick(2026, 5, 1, 'RB', 30),
      pick(2026, 9, 1, 'WR', 20),
    ]
    const s = draftDna(picks, [], 1).seasons[0]
    // $50 of $100 lands exactly on the first pick.
    expect(s.halfwayPick).toBe(1)
    expect(s.halfwayFraction).toBeCloseTo(1 / 9)
  })

  it('keeps a traded player’s spend with whoever drafted them', () => {
    // Manager 1 buys a $47 back and ships them to manager 2 in November.
    const rb = pick(2026, 1, 2, 'RB', 47) // manager_id is CURRENT ownership
    const mine = pick(2026, 2, 1, 'WR', 53)
    const theirs = pick(2026, 3, 2, 'QB', 100)
    const trades = [trade(1, 1, 2, [{ pickId: rb.id, toManagerId: 2 }])]

    const one = draftDna([rb, mine, theirs], trades, 1).seasons[0]
    const two = draftDna([rb, mine, theirs], trades, 2).seasons[0]

    expect(one.spent).toBe(100)
    expect(one.positionShare.RB).toBeCloseTo(0.47)
    expect(two.spent).toBe(100)
    expect(two.positionShare.RB).toBe(0)
  })

  it('reports an unscored season as null, never zero', () => {
    const unplayed = [pick(2027, 1, 1, 'QB', 60), pick(2027, 2, 2, 'RB', 40)]
    const played = [
      pick(2026, 1, 1, 'QB', 60, 300),
      pick(2026, 2, 1, 'QB', 10, 400),
      pick(2026, 3, 2, 'QB', 40, 200),
    ]
    const { seasons, career } = draftDna([...unplayed, ...played], [], 1)

    expect(seasons.find((s) => s.season === 2027)!.placesGained).toBeNull()
    // The $10 QB finished ahead of both pricier ones: +2 on their price.
    expect(seasons.find((s) => s.season === 2026)!.placesGained).toBe(1)
    // The career total covers only the season that has points.
    expect(career.placesGained).toBe(1)
  })

  it('has a null career halfway and places when nothing is on record', () => {
    const { career } = draftDna([pick(2026, 1, 1, 'QB', 0)], [], 1)
    expect(career.placesGained).toBeNull()
    expect(career.seasons).toBe(1)
  })

  it('weights career position share by dollars, not by season', () => {
    // A $10 season and a $190 season must not count equally.
    const picks = [
      pick(2025, 1, 1, 'QB', 10),
      pick(2026, 1, 1, 'RB', 190),
    ]
    const { career } = draftDna(picks, [], 1)
    expect(career.positionShare.RB).toBeCloseTo(0.95)
    expect(career.positionShare.QB).toBeCloseTo(0.05)
  })

  it('lists seasons newest first and skips ones they did not draft in', () => {
    const picks = [
      pick(2024, 1, 2, 'QB', 50),
      pick(2025, 1, 1, 'QB', 50),
      pick(2026, 1, 1, 'RB', 50),
    ]
    expect(draftDna(picks, [], 1).seasons.map((s) => s.season)).toEqual([2026, 2025])
  })
})
