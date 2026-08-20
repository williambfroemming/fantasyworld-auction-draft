/**
 * Aggregation rules for the player view. Pure — no database.
 *
 * The SQL that feeds this is exercised against real data; what is worth pinning
 * down here is the shaping, because every rule below is a decision that could
 * defensibly have gone the other way and would be silently wrong if it drifted.
 */
import { describe, expect, it } from 'vitest'
import {
  buildPlayerHistory,
  type PlayerDraftRow,
  type PlayerWeekRow,
} from './history-service'

function week(over: Partial<PlayerWeekRow> = {}): PlayerWeekRow {
  return {
    season: 2023,
    week: 1,
    managerId: 1,
    displayName: 'Bill',
    points: 10,
    isStarter: true,
    isPlayoff: false,
    playerName: 'Derrick Henry',
    position: 'RB',
    ...over,
  }
}

function draft(over: Partial<PlayerDraftRow> = {}): PlayerDraftRow {
  return {
    season: 2023,
    managerId: 2,
    displayName: 'Bolek',
    price: 37,
    nominatorId: 2,
    nominatorName: 'Bolek',
    ...over,
  }
}

describe('buildPlayerHistory', () => {
  it('returns null for a player with no weeks on record', () => {
    expect(buildPlayerHistory('3198', [])).toBeNull()
  })

  it('counts rostered points in the headline, and starts separately', () => {
    const h = buildPlayerHistory('3198', [
      week({ week: 1, points: 20, isStarter: true }),
      week({ week: 2, points: 5, isStarter: false }),
    ])!

    // The benched week still happened to the player, so it belongs in the total.
    // Dropping it would answer a manager's question on a player's page.
    expect(h.points).toBe(25)
    expect(h.pointsStarted).toBe(20)
    expect(h.weeksRostered).toBe(2)
    expect(h.weeksStarted).toBe(1)
  })

  it('splits a season across every manager who held them, most weeks first', () => {
    const h = buildPlayerHistory('3198', [
      week({ week: 1, managerId: 2, displayName: 'Bolek', points: 10 }),
      week({ week: 2, managerId: 2, displayName: 'Bolek', points: 10 }),
      week({ week: 3, managerId: 1, displayName: 'Bill', points: 30 }),
      week({ week: 4, managerId: 3, displayName: 'Justin', points: 1 }),
    ])!

    const season = h.seasons[0]
    expect(season.owners.map((o) => o.displayName)).toEqual(['Bolek', 'Bill', 'Justin'])
    expect(season.owners[0].weeksRostered).toBe(2)
    expect(season.points).toBe(51)
  })

  it('breaks an ownership tie on points, not on insertion order', () => {
    const h = buildPlayerHistory('3198', [
      week({ week: 1, managerId: 1, displayName: 'Bill', points: 5 }),
      week({ week: 2, managerId: 2, displayName: 'Bolek', points: 40 }),
    ])!

    // Equal weeks; the more productive stint leads.
    expect(h.owners.map((o) => o.displayName)).toEqual(['Bolek', 'Bill'])
  })

  it('accumulates career ownership across seasons', () => {
    const h = buildPlayerHistory('3198', [
      week({ season: 2024, week: 1, managerId: 4, displayName: 'Nate', points: 10 }),
      week({ season: 2025, week: 1, managerId: 4, displayName: 'Nate', points: 12 }),
      week({ season: 2025, week: 2, managerId: 1, displayName: 'Bill', points: 30 }),
    ])!

    expect(h.owners[0]).toMatchObject({ displayName: 'Nate', weeksRostered: 2, points: 22 })
    expect(h.firstSeason).toBe(2024)
    expect(h.lastSeason).toBe(2025)
  })

  it('reports the best single week and who was holding them', () => {
    const h = buildPlayerHistory('3198', [
      week({ season: 2022, week: 8, managerId: 5, displayName: 'Mario', points: 41.2 }),
      week({ season: 2025, week: 3, managerId: 4, displayName: 'Nate', points: 12 }),
    ])!

    expect(h.best).toMatchObject({ season: 2022, week: 8, points: 41.2, displayName: 'Mario' })
  })

  it('gives a tied best week to the earlier one', () => {
    const h = buildPlayerHistory('3198', [
      week({ season: 2022, week: 2, points: 30, displayName: 'Bill' }),
      week({ season: 2024, week: 9, points: 30, displayName: 'Nate' }),
    ])!

    expect(h.best).toMatchObject({ season: 2022, week: 2 })
  })

  it('counts a benched week as the best if it was the biggest', () => {
    // The player scored it. That it sat on a bench is the manager's problem and
    // is recorded on the week, not a reason to hide the performance.
    const h = buildPlayerHistory('3198', [
      week({ week: 1, points: 12, isStarter: true }),
      week({ week: 2, points: 44, isStarter: false }),
    ])!

    expect(h.best).toMatchObject({ week: 2, points: 44, isStarter: false })
  })

  it('attaches a draft only to the season it happened in', () => {
    const h = buildPlayerHistory(
      '3198',
      [week({ season: 2022, week: 1 }), week({ season: 2023, week: 1 })],
      [draft()],
    )!

    expect(h.seasons.find((s) => s.season === 2022)!.draft).toBeNull()
    expect(h.seasons.find((s) => s.season === 2023)!.draft).toMatchObject({
      displayName: 'Bolek',
      price: 37,
    })
  })

  it('keeps the drafter even when someone else finished the season with them', () => {
    // The 2023 Derrick Henry case: Bolek bought him, Bill ended up with him. The
    // price belongs to the buyer — `getPlayerHistory` resolves that through
    // `draftersByPick` before this function ever sees it.
    const h = buildPlayerHistory(
      '3198',
      [
        week({ season: 2023, week: 1, managerId: 2, displayName: 'Bolek' }),
        week({ season: 2023, week: 2, managerId: 1, displayName: 'Bill' }),
        week({ season: 2023, week: 3, managerId: 1, displayName: 'Bill' }),
      ],
      [draft()],
    )!

    expect(h.seasons[0].owners[0].displayName).toBe('Bill') // most weeks
    expect(h.seasons[0].draft!.displayName).toBe('Bolek') // but Bolek paid
  })

  describe('nomination history', () => {
    it('records who threw the name out when it was not the buyer', () => {
      const h = buildPlayerHistory(
        '3198',
        [week({ season: 2025, week: 1 })],
        [
          draft({
            season: 2025,
            managerId: 4,
            displayName: 'Nate',
            price: 44,
            nominatorId: 1,
            nominatorName: 'Bill',
          }),
        ],
      )!

      expect(h.seasons[0].draft).toMatchObject({
        displayName: 'Nate',
        price: 44,
        nominatedBy: { managerId: 1, displayName: 'Bill' },
        nominatorWon: false,
      })
    })

    it('flags the case where the nominator kept them', () => {
      const h = buildPlayerHistory('3198', [week()], [draft()])!
      expect(h.seasons[0].draft!.nominatorWon).toBe(true)
    })

    /**
     * The nominator is compared to the **drafter**, not to whoever holds the
     * pick now. A pick that was traded away still belongs, for this question, to
     * the person who bid on it in the room.
     */
    it('compares the nominator against the drafter, not the current owner', () => {
      const h = buildPlayerHistory(
        '3198',
        [week({ managerId: 9, displayName: 'Someone Else' })],
        [draft({ managerId: 2, nominatorId: 2, nominatorName: 'Bolek' })],
      )!

      expect(h.seasons[0].owners[0].displayName).toBe('Someone Else')
      expect(h.seasons[0].draft!.nominatorWon).toBe(true)
    })

    it('survives a missing nominator rather than inventing one', () => {
      const h = buildPlayerHistory(
        '3198',
        [week()],
        [draft({ nominatorId: null, nominatorName: null })],
      )!

      expect(h.seasons[0].draft!.nominatedBy).toBeNull()
      expect(h.seasons[0].draft!.nominatorWon).toBe(false)
    })
  })

  describe('playoff split', () => {
    it('splits a season on the flag the caller resolved', () => {
      const h = buildPlayerHistory('3198', [
        week({ week: 13, points: 10, isPlayoff: false }),
        week({ week: 14, points: 20, isPlayoff: false }),
        week({ week: 15, points: 30, isPlayoff: true }),
        week({ week: 16, points: 40, isPlayoff: true }),
      ])!

      expect(h.seasons[0].regular).toMatchObject({ weeksRostered: 2, points: 30 })
      expect(h.seasons[0].playoff).toMatchObject({ weeksRostered: 2, points: 70 })
      expect(h.regular.points + h.playoff.points).toBe(h.points)
    })

    it('accumulates the split across seasons', () => {
      const h = buildPlayerHistory('3198', [
        week({ season: 2024, week: 15, points: 25, isPlayoff: true }),
        week({ season: 2025, week: 16, points: 15, isPlayoff: true }),
        week({ season: 2025, week: 1, points: 5, isPlayoff: false }),
      ])!

      expect(h.playoff).toMatchObject({ weeksRostered: 2, points: 40 })
      expect(h.regular).toMatchObject({ weeksRostered: 1, points: 5 })
    })

    it('counts benched playoff weeks as rostered but not started', () => {
      const h = buildPlayerHistory('3198', [
        week({ week: 15, points: 30, isPlayoff: true, isStarter: false }),
      ])!

      expect(h.playoff).toMatchObject({
        weeksRostered: 1,
        weeksStarted: 0,
        points: 30,
        pointsStarted: 0,
      })
    })

    it('puts everything in the regular season when no boundary is known', () => {
      // `getPlayerHistory` passes isPlayoff=false when a season has no
      // playoff_week_start, rather than guessing a week number.
      const h = buildPlayerHistory('3198', [
        week({ week: 16, points: 30, isPlayoff: false }),
      ])!

      expect(h.playoff.weeksRostered).toBe(0)
      expect(h.regular.weeksRostered).toBe(1)
    })
  })

  it('returns the weekly series oldest first, for the chart', () => {
    const h = buildPlayerHistory('3198', [
      week({ season: 2025, week: 2 }),
      week({ season: 2024, week: 5 }),
      week({ season: 2025, week: 1 }),
    ])!

    expect(h.weekly.map((w) => `${w.season}w${w.week}`)).toEqual(['2024w5', '2025w1', '2025w2'])
  })

  it('does not accumulate float drift across a long career', () => {
    const rows = Array.from({ length: 97 }, (_, i) =>
      week({ season: 2020 + Math.floor(i / 17), week: (i % 17) + 1, points: 0.1 }),
    )
    expect(buildPlayerHistory('3198', rows)!.points).toBe(9.7)
  })
})
