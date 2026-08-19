import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MEMBERS,
  SLEEPER_IMPORT_SEASONS,
  SLEEPER_LEAGUE_IDS,
  isKnownName,
  managerIdForMemberId,
  managerIdForName,
  managerIdForSleeperOwner,
  memberByManagerId,
  verifyLeagueChain,
} from './history-identity'

const DATA = join(process.cwd(), 'data')

/** Minimal CSV reader. The committed files are machine-written and quote-free. */
function readCsv(name: string): Array<Record<string, string>> {
  const path = join(DATA, 'history', `${name}.csv`)
  const lines = readFileSync(path, 'utf8').trim().split('\n')
  const header = lines[0].split(',')
  return lines.slice(1).map((line) => {
    const cells = line.split(',')
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']))
  })
}

describe('the map itself', () => {
  it('covers exactly managers 1-10, one seat each', () => {
    const ids = MEMBERS.map((m) => m.managerId).sort((a, b) => a - b)
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('uses each workbook member_id exactly once', () => {
    const ids = MEMBERS.map((m) => m.workbookMemberId).sort((a, b) => a - b)
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('never lets two seats share a Sleeper user_id', () => {
    const all = MEMBERS.flatMap((m) => m.sleeperUserIds)
    expect(new Set(all).size).toBe(all.length)
  })

  it('round-trips manager id -> member -> manager id', () => {
    for (const m of MEMBERS) {
      expect(memberByManagerId(m.managerId)).toBe(m)
      expect(managerIdForMemberId(m.workbookMemberId)).toBe(m.managerId)
      expect(managerIdForName(m.appName)).toBe(m.managerId)
      expect(managerIdForName(m.workbookName)).toBe(m.managerId)
      for (const id of m.sleeperUserIds) expect(managerIdForSleeperOwner(id)).toBe(m.managerId)
    }
  })

  it('resolves the three renamed seats across all three namespaces', () => {
    // The whole reason this file exists. Each of these is one person.
    expect(managerIdForName('Bolek')).toBe(managerIdForName('Jon'))
    expect(managerIdForName('Gabes')).toBe(managerIdForName('Brian'))
    expect(managerIdForName('Grossman')).toBe(managerIdForName('Eric + Mark'))
    expect(managerIdForName('Grossman')).toBe(managerIdForName('Eric/Blakey'))
    // gizzle4 owns the roster; markcubs is the co-owner. One seat, two humans.
    expect(managerIdForSleeperOwner('597851820731203584')).toBe(managerIdForName('Grossman'))
    expect(managerIdForSleeperOwner('612336986497318912')).toBe(managerIdForName('Grossman'))
  })

  it('is case- and whitespace-insensitive on names', () => {
    // The 2025 draft sheet contains lower-cased entries.
    expect(managerIdForName('  grossman ')).toBe(managerIdForName('Grossman'))
    expect(managerIdForName('BOLEK')).toBe(managerIdForName('Bolek'))
  })

  it('throws rather than guessing', () => {
    // An unmapped name means a source holds someone the league has no record
    // of. Dropping the row would silently lose a person's season.
    expect(() => managerIdForName('Gronk')).toThrow(/no member named/)
    expect(() => managerIdForMemberId(11)).toThrow(/workbook member_id/)
    expect(() => managerIdForSleeperOwner('0')).toThrow(/Sleeper user_id/)
    expect(() => memberByManagerId(99)).toThrow(/managers.id/)
    expect(isKnownName('Gronk')).toBe(false)
  })
})

describe('the league chain', () => {
  it('accepts the real chain', () => {
    const chain = Object.fromEntries(
      [...SLEEPER_IMPORT_SEASONS].map((s) => [
        s,
        {
          league_id: SLEEPER_LEAGUE_IDS[s],
          previous_league_id: s === 2020 ? null : SLEEPER_LEAGUE_IDS[s - 1],
        },
      ]),
    )
    expect(() => verifyLeagueChain(chain)).not.toThrow()
  })

  it('rejects a league that is not the pinned one', () => {
    // The failure this guards: the account also holds an 18-team Guillotine
    // League in 2024/2025, and the real 2025 league is misnamed with 2024's
    // name. Picking by name would import a different league entirely.
    expect(() =>
      verifyLeagueChain({
        2024: { league_id: '1123701398459363328', previous_league_id: SLEEPER_LEAGUE_IDS[2023] },
      }),
    ).toThrow(/expected the pinned/)
  })

  it('rejects a broken predecessor link', () => {
    expect(() =>
      verifyLeagueChain({
        2023: { league_id: SLEEPER_LEAGUE_IDS[2023], previous_league_id: '999' },
      }),
    ).toThrow(/points back at 999/)
  })
})

// ---------------------------------------------------------------------------
// The assertions a database table could not offer: every name and every owner
// id in every committed source file must resolve. These run against the real
// data, so a source that gains an unmapped spelling fails the build.
// ---------------------------------------------------------------------------

const hasWorkbook = existsSync(join(DATA, 'history', 'member.csv'))

describe.runIf(hasWorkbook)('every name in the committed workbook CSVs', () => {
  const NAME_COLUMNS: Array<[string, string[]]> = [
    ['member', ['member_name']],
    ['regular_season', ['member']],
    ['playoffs_legacy', ['member']],
    ['win_history', ['member']],
    ['legacy_champions', ['member']],
    ['auction_drafts', ['nominator', 'drafted_by']],
  ]

  for (const [file, columns] of NAME_COLUMNS) {
    it(`${file}.csv resolves`, () => {
      const rows = readCsv(file)
      expect(rows.length).toBeGreaterThan(0)
      const unresolved = new Set<string>()
      for (const row of rows) {
        for (const col of columns) {
          const value = row[col]
          if (value && !isKnownName(value)) unresolved.add(`${col}="${value}"`)
        }
      }
      expect([...unresolved]).toEqual([])
    })
  }

  it('agrees with the workbook wherever a row carries both member_id and a name', () => {
    // An independent check of the mapping: the workbook states the pairing
    // itself, thousands of times, and every one must match.
    const checks: Array<[string, string, string]> = [
      ['member', 'member_id', 'member_name'],
      ['regular_season', 'member_id', 'member'],
      ['playoffs_legacy', 'member_id', 'member'],
      ['win_history', 'member_id', 'member'],
      ['auction_drafts', 'member_id', 'drafted_by'],
    ]
    for (const [file, idCol, nameCol] of checks) {
      for (const row of readCsv(file)) {
        if (!row[idCol] || !row[nameCol]) continue
        expect(
          managerIdForMemberId(Number(row[idCol])),
          `${file}.csv: member_id ${row[idCol]} vs name "${row[nameCol]}"`,
        ).toBe(managerIdForName(row[nameCol]))
      }
    }
  })

  it('has all ten members in the workbook roster', () => {
    const resolved = readCsv('member').map((r) => managerIdForName(r.member_name))
    expect([...resolved].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })
})

const sleeperDir = join(DATA, 'sleeper')
const hasSleeper = existsSync(sleeperDir)

describe.runIf(hasSleeper)('every Sleeper owner in the committed pulls', () => {
  const seasons = readdirSync(sleeperDir).filter((d) => /^\d{4}$/.test(d))

  it('has at least one pulled season', () => {
    expect(seasons.length).toBeGreaterThan(0)
  })

  for (const season of seasons) {
    it(`${season} resolves every roster owner and co-owner`, () => {
      const rosters = JSON.parse(
        readFileSync(join(sleeperDir, season, 'rosters.json'), 'utf8'),
      ) as Array<{ roster_id: number; owner_id: string; co_owners: string[] | null }>

      expect(rosters).toHaveLength(10)
      const owners = rosters.map((r) => managerIdForSleeperOwner(r.owner_id))
      // Ten rosters, ten distinct managers -- nobody owns two seats.
      expect([...owners].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

      for (const r of rosters) {
        for (const co of r.co_owners ?? []) {
          // A co-owner must map to the same seat as the owner, or the roster
          // belongs to two different managers at once.
          expect(managerIdForSleeperOwner(co)).toBe(managerIdForSleeperOwner(r.owner_id))
        }
      }
    })
  }
})
