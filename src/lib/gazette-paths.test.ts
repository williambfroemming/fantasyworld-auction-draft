import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  pathIndex,
  resolvePackPath,
  sliceFacts,
  ungroundedNumbers,
  unresolvedPaths,
  type GazetteFacts,
} from './gazette'

/**
 * Pack paths are how the editorial room cites evidence. These run against a
 * real committed pack (2025 week 10) rather than a fixture, because the point is
 * that a path the Story Desk reads off the index resolves in the pack the
 * Writer and the grounding gate actually use.
 */
const archive = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../data/history/gazette/2025.json'), 'utf8'),
) as { issues: Record<string, { facts: GazetteFacts }> }

// Week 10 predates ROSTERS (v16), so graft one on to cover the section.
const pack: GazetteFacts = {
  ...archive.issues['10'].facts,
  rosters: [
    {
      manager: 'Mario',
      points: 165.3,
      carriedBy: [{ player: 'Jonathan Taylor', position: 'RB', points: 55.6, started: true, price: 61 }],
      biggestBuy: null,
    },
  ],
}

/**
 * The pack's content: without the continuity fields a slice never carries, and
 * without empty or null sections (nothing to cite, so nothing to slice). The
 * always-carried `notes` stay even when empty.
 */
function content(f: GazetteFacts) {
  const c: Record<string, unknown> = { ...f }
  for (const k of ['kind', 'priorThreads', 'priorColumns', 'priorHeadlines', 'priorLenses', 'reservedGenres']) {
    delete c[k]
  }
  for (const [k, v] of Object.entries(c)) {
    if (k !== 'notes' && (v === null || (Array.isArray(v) && v.length === 0))) delete c[k]
  }
  return c
}

describe('resolvePackPath', () => {
  it('resolves rows, leaves and whole sections', () => {
    expect(resolvePackPath(pack, 'games[0]')).toEqual(pack.games[0])
    expect(resolvePackPath(pack, 'games[0].margin')).toBe(pack.games[0].margin)
    expect(resolvePackPath(pack, 'belt')).toEqual(pack.belt)
    expect(resolvePackPath(pack, 'belt.mostWeeks.weeks')).toBe(pack.belt!.mostWeeks!.weeks)
    expect(resolvePackPath(pack, 'rosters[0].carriedBy[0].price')).toBe(61)
    expect(resolvePackPath(pack, 'stats[1]')).toEqual(pack.stats[1])
    expect(resolvePackPath(pack, ' milestones[0] ')).toEqual(pack.milestones[0])
  })

  it('round-trips every path the index lists', () => {
    const index = pathIndex(pack)
    expect(index.length).toBeGreaterThan(20)
    for (const { path } of index) expect(resolvePackPath(pack, path)).not.toBeNull()
  })

  it('returns null for anything that is not in the pack', () => {
    for (const bad of [
      'games[99]',
      'games[0].nope',
      'nope',
      'games.0',
      'games[]',
      'games[0]..margin',
      '[0]',
      'games[0]margin',
      'games[-1]',
      '',
      'games[0].margin.extra',
    ]) {
      expect(resolvePackPath(pack, bad), bad).toBeNull()
    }
  })

  it('does not address continuity: the notebook is handed over separately', () => {
    expect(resolvePackPath(pack, 'priorThreads[0]')).toBeNull()
    expect(resolvePackPath(pack, 'priorColumns')).toBeNull()
    expect(resolvePackPath(pack, 'reservedGenres[0]')).toBeNull()
  })

  it('treats a null section as unresolvable, since an absence is not evidence', () => {
    expect(resolvePackPath({ ...pack, belt: null }, 'belt')).toBeNull()
  })

  it('unresolvedPaths names only the bad ones, once each', () => {
    expect(unresolvedPaths(pack, ['games[0]', 'games[99]', 'games[99]', 'belt'])).toEqual(['games[99]'])
  })
})

describe('sliceFacts', () => {
  it('a slice of every indexed path deep-equals the pack content', () => {
    const all = pathIndex(pack).map((e) => e.path)
    expect(sliceFacts(pack, all)).toEqual(content(pack))
  })

  it('carries the always-needed scalars and nothing uncited', () => {
    const s = sliceFacts(pack, ['games[2].margin'])
    expect(s.season).toBe(2025)
    expect(s.week).toBe(10)
    expect(s.weekLabel).toBe(pack.weekLabel)
    expect(s.genre).toBe(pack.genre)
    expect(s.phase).toBe(pack.phase)
    expect(s.teamsPlaying).toBe(pack.teamsPlaying)
    expect(s.notes).toEqual(pack.notes)
    expect(s.standings).toBeUndefined()
    expect(s.priorThreads).toBeUndefined()
  })

  it('widens a leaf to its row and keeps the row at its own index', () => {
    const s = sliceFacts(pack, ['games[2].margin', 'stats[1]'])
    expect(s.games).toEqual([null, null, pack.games[2]])
    expect(s.stats).toEqual([null, pack.stats[1]])
  })

  it('ignores paths that do not resolve rather than inventing a section', () => {
    const s = sliceFacts(pack, ['games[99]', 'nope', 'belt'])
    expect(s.games).toBeUndefined()
    expect(s.belt).toEqual(pack.belt)
  })

  it('never authorises a figure the full pack does not: grounding stays on the full pack', () => {
    // Belt-and-braces: a slice is a subset, so anything grounded against a
    // slice is grounded against the pack. The reverse is not true, which is why
    // the gate reads the full pack.
    const text = `${pack.games[2].winnerPoints} and ${pack.standings[0].pointsFor}`
    expect(ungroundedNumbers(text, pack)).toEqual([])
    expect(ungroundedNumbers(text, sliceFacts(pack, ['games[2]']) as GazetteFacts)).toHaveLength(1)
  })
})

describe('pathIndex', () => {
  it('labels rows in words the Story Desk can choose between', () => {
    const index = pathIndex(pack)
    const game = index.find((e) => e.path === 'games[0]')!
    expect(game.label).toContain(pack.games[0].winner!)
    expect(game.label).toContain(pack.games[0].loser!)
    expect(index.find((e) => e.path === 'belt')!.label).toContain(pack.belt!.manager)
    expect(index.find((e) => e.path === 'rosters[0]')!.label).toContain('Jonathan Taylor')
  })

  it('every label is grounded: a Desk that copies one cannot fail the gate', () => {
    const labels = pathIndex(pack).map((e) => e.label).join('\n')
    expect(ungroundedNumbers(labels, pack)).toEqual([])
  })

  it('lists nothing from the continuity fields', () => {
    expect(pathIndex(pack).some((e) => /^prior|^reserved/.test(e.path))).toBe(false)
  })

  it('indexes a section it has no labeller for', () => {
    const extra = { ...pack, playerLines: [{ player: 'Puka Nacua', note: 'ten catches' }] } as GazetteFacts
    expect(pathIndex(extra).find((e) => e.path === 'playerLines[0]')?.label).toContain('Puka Nacua')
  })
})
