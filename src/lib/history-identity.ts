/**
 * Who is who, across every source the league's history lives in.
 *
 * Phase 2 imports sixteen seasons from three places that have never agreed on a
 * name:
 *
 *  - **the app** calls people `Gabes`, `Bolek`, `Grossman` (`managers.name`)
 *  - **the history workbook** calls the same people `Brian`, `Jon`, `Eric + Mark`
 *  - **Sleeper** calls them `bgabrielsen`, `OGJonnyB`, `gizzle4`
 *
 * and none of the three shares an id space either — the workbook's `member_id`
 * is not `managers.id` (Bill is workbook 1 and manager 4; Bryan is workbook 3
 * and manager 9). This file is the single place those three namespaces are
 * reconciled.
 *
 * ## Why a constant and not a table
 *
 * Nothing at runtime ever consults this. Every row an importer writes carries an
 * already-resolved `manager_id`, so the mapping is needed **only at import
 * time**. A database table would be a second place the truth could drift, sitting
 * on a request path that never reads it. A frozen constant gets code review, gets
 * diffed, and — through `history-identity.test.ts` — gets an assertion no table
 * could offer: that every distinct name appearing in every committed source file
 * resolves, and that each map is a bijection onto managers 1–10.
 *
 * ## Every lookup throws
 *
 * There is no "unknown manager" fallback anywhere in this file, and there must
 * never be one. An unmapped name is not a row to skip — it means a source
 * contains someone this league has no record of, and the correct response is to
 * stop the import rather than silently drop a season's worth of a person. The
 * league has had **the same ten members since 2011**, so any miss is a bug in the
 * mapping, not a real eleventh manager.
 */

/** `managers.id` in the live database. Stable; assigned when the app was seeded. */
export const MANAGER_IDS = {
  GABES: 1,
  GROSSMAN: 2,
  BOLEK: 3,
  BILL: 4,
  DANIEL: 5,
  NATE: 6,
  MARIO: 7,
  JACK: 8,
  BRYAN: 9,
  JUSTIN: 10,
} as const

export interface MemberIdentity {
  /** `managers.id` — the only id that means anything to the app. */
  managerId: number
  /** `managers.name`, the app's canonical key and what the board says. */
  appName: string
  /** What the history workbook's `member` sheet calls them. */
  workbookName: string
  /** The workbook's own `member_id`. NOT `managers.id`. */
  workbookMemberId: number
  /**
   * Sleeper `user_id`s. Usually one; the co-managed seat has two, and display
   * names are NOT stable (`gizzle4` appears as `gawz` in one season), which is
   * exactly why this keys on the immutable user_id.
   */
  sleeperUserIds: string[]
  /**
   * Every other spelling seen in a source file. `Eric/Blakey` is the app's
   * `display_name`; `Grossman` is how the workbook's *nominator* column spells
   * the seat its *drafted_by* column calls `Eric + Mark`.
   */
  aliases: string[]
}

/**
 * The ten seats. Derivations, so a future reader can re-check rather than trust:
 *
 *  - **Bolek = Jon, Gabes = Brian, Grossman = Eric + Mark** — joined
 *    `auction_drafts` (workbook, real names) to `Drafts/AllTimeDraftData.xlsx`
 *    (nicknames) on (year, player). 40+ concordant picks per seat, zero conflicts.
 *  - **Sleeper user_ids** — matched each owner's 2022 drafted roster against the
 *    workbook's 2022 `drafted_by`. Every owner scored 16/16 against exactly one
 *    member with the runner-up at **zero**. Perfect separation, no judgement call.
 *  - **markcubs** is a Sleeper *co-owner* of gizzle4's roster from 2023 onward —
 *    the "Mark" in "Eric + Mark". One seat, two humans, two user_ids.
 */
export const MEMBERS: readonly MemberIdentity[] = [
  {
    managerId: MANAGER_IDS.GABES,
    appName: 'Gabes',
    workbookName: 'Brian',
    workbookMemberId: 2,
    sleeperUserIds: ['599337029230194688'],
    aliases: [],
  },
  {
    managerId: MANAGER_IDS.GROSSMAN,
    appName: 'Grossman',
    workbookName: 'Eric + Mark',
    workbookMemberId: 5,
    // gizzle4 owns the roster; markcubs is the co-owner added in 2023.
    sleeperUserIds: ['597851820731203584', '612336986497318912'],
    aliases: ['Eric/Blakey', 'Eric', 'Eric + Mark', 'gawz'],
  },
  {
    managerId: MANAGER_IDS.BOLEK,
    appName: 'Bolek',
    workbookName: 'Jon',
    workbookMemberId: 7,
    sleeperUserIds: ['597587057577086976'],
    aliases: [],
  },
  {
    managerId: MANAGER_IDS.BILL,
    appName: 'Bill',
    workbookName: 'Bill',
    workbookMemberId: 1,
    sleeperUserIds: ['597564674589913088'],
    aliases: [],
  },
  {
    managerId: MANAGER_IDS.DANIEL,
    appName: 'Daniel',
    workbookName: 'Daniel',
    workbookMemberId: 4,
    sleeperUserIds: ['596552796187181056'],
    aliases: [],
  },
  {
    managerId: MANAGER_IDS.NATE,
    appName: 'Nate',
    workbookName: 'Nate',
    workbookMemberId: 10,
    sleeperUserIds: ['597822038236774400'],
    aliases: [],
  },
  {
    managerId: MANAGER_IDS.MARIO,
    appName: 'Mario',
    workbookName: 'Mario',
    workbookMemberId: 9,
    sleeperUserIds: ['598753920659034112'],
    aliases: [],
  },
  {
    managerId: MANAGER_IDS.JACK,
    appName: 'Jack',
    workbookName: 'Jack',
    workbookMemberId: 6,
    sleeperUserIds: ['597587272728113152'],
    aliases: [],
  },
  {
    managerId: MANAGER_IDS.BRYAN,
    appName: 'Bryan',
    workbookName: 'Bryan',
    workbookMemberId: 3,
    sleeperUserIds: ['482305993246502912'],
    aliases: [],
  },
  {
    managerId: MANAGER_IDS.JUSTIN,
    appName: 'Justin',
    workbookName: 'Justin',
    workbookMemberId: 8,
    sleeperUserIds: ['596547532989972480'],
    aliases: [],
  },
] as const

/**
 * The league's Sleeper seasons.
 *
 * ⚠️ **Never select these by name.** The account also holds an unrelated 18-team
 * *Guillotine League* in 2024 and 2025, and the real 2025 league is **misnamed
 * "Fantasy 101 XIX"** — the same name 2024 carries. A name match picks the wrong
 * league and imports ten strangers' seasons under this league's names, which
 * would look entirely plausible. `verifyLeagueChain()` walks Sleeper's own
 * `previous_league_id` links instead, which cannot be fooled by a typo.
 *
 * 2020 is the first Sleeper season (the league kept score elsewhere before that)
 * and 2026 is in progress, so the importable range is 2020–2025.
 */
export const SLEEPER_LEAGUE_IDS: Readonly<Record<number, string>> = {
  2020: '596553726760632320',
  2021: '726144978962747392',
  2022: '862818439088189440',
  2023: '994041566085910528',
  2024: '1124822672346198016',
  2025: '1257436698095136768',
  2026: '1389719640493551616',
}

/**
 * The seasons imported from Sleeper as a finished historical backfill.
 *
 * The current season is deliberately NOT in this list — it is refreshed on its
 * own cadence by `npm run history:refresh`, because re-pulling six settled
 * seasons every week to learn one new week of results is waste and churns six
 * seasons of committed files for no reason.
 */
export const SLEEPER_IMPORT_SEASONS = [2020, 2021, 2022, 2023, 2024, 2025] as const

/**
 * The season currently being played.
 *
 * ⚠️ The one place a literal current year is allowed, and it has to move every
 * August alongside `npm run season:new`. Everything else derives its seasons
 * from the data. `history:refresh` reads this to know what to pull.
 */
export const CURRENT_SLEEPER_SEASON = 2026

// ---------------------------------------------------------------------------
// Lookups. All of them throw; see the header.
// ---------------------------------------------------------------------------

function normalizeName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

const BY_MANAGER_ID = new Map(MEMBERS.map((m) => [m.managerId, m]))
const BY_WORKBOOK_ID = new Map(MEMBERS.map((m) => [m.workbookMemberId, m]))
const BY_SLEEPER_ID = new Map(MEMBERS.flatMap((m) => m.sleeperUserIds.map((id) => [id, m] as const)))

const BY_NAME = new Map<string, MemberIdentity>()
for (const m of MEMBERS) {
  for (const n of [m.appName, m.workbookName, ...m.aliases]) {
    const key = normalizeName(n)
    const clash = BY_NAME.get(key)
    if (clash && clash !== m) {
      // A build-time guard, not a runtime one: two seats claiming one spelling
      // would silently attribute one member's history to another.
      throw new Error(`history-identity: "${n}" is claimed by both ${clash.appName} and ${m.appName}`)
    }
    BY_NAME.set(key, m)
  }
}

export function memberByManagerId(managerId: number): MemberIdentity {
  const m = BY_MANAGER_ID.get(managerId)
  if (!m) throw new Error(`history-identity: no member with managers.id ${managerId}`)
  return m
}

/** The workbook's `member_id`. Emphatically not `managers.id`. */
export function managerIdForMemberId(workbookMemberId: number): number {
  const m = BY_WORKBOOK_ID.get(workbookMemberId)
  if (!m) throw new Error(`history-identity: no member with workbook member_id ${workbookMemberId}`)
  return m.managerId
}

/**
 * Resolve any spelling from any source — app, workbook, or the 2025 draft sheet.
 *
 * This has to span namespaces because a single sheet mixes them: the workbook's
 * `auction_drafts` names the nominator `Grossman` and the buyer `Eric + Mark`,
 * for the same seat, in the same row.
 */
export function managerIdForName(name: string): number {
  const m = BY_NAME.get(normalizeName(name))
  if (!m) throw new Error(`history-identity: no member named "${name}"`)
  return m.managerId
}

/** Sleeper `user_id` — from `rosters[].owner_id` or a roster's `co_owners`. */
export function managerIdForSleeperOwner(userId: string): number {
  const m = BY_SLEEPER_ID.get(userId)
  if (!m) throw new Error(`history-identity: no member with Sleeper user_id ${userId}`)
  return m.managerId
}

/** True when a name is resolvable, for callers that want to report rather than throw. */
export function isKnownName(name: string): boolean {
  return BY_NAME.has(normalizeName(name))
}

/**
 * Assert Sleeper's own `previous_league_id` links match {@link SLEEPER_LEAGUE_IDS}.
 *
 * `leagues` maps season to the `{ league_id, previous_league_id }` Sleeper
 * returned. Throws on the first disagreement — see the warning on
 * SLEEPER_LEAGUE_IDS for why this is worth doing rather than trusting the map.
 */
export function verifyLeagueChain(
  leagues: Record<number, { league_id: string; previous_league_id: string | null }>,
): void {
  const seasons = Object.keys(leagues)
    .map(Number)
    .sort((a, b) => a - b)

  for (const season of seasons) {
    const pinned = SLEEPER_LEAGUE_IDS[season]
    const actual = leagues[season].league_id
    if (pinned !== actual) {
      throw new Error(`league chain: ${season} is ${actual}, expected the pinned ${pinned}`)
    }
    const prev = leagues[season].previous_league_id
    const expectedPrev = SLEEPER_LEAGUE_IDS[season - 1]
    // 2020 is the first Sleeper season, so a null predecessor is correct there
    // and only there.
    if (season === 2020) {
      if (prev) throw new Error(`league chain: 2020 should start the chain but points back at ${prev}`)
      continue
    }
    if (!expectedPrev) continue
    if (prev !== expectedPrev) {
      throw new Error(
        `league chain: ${season} points back at ${prev}, but ${season - 1} is ${expectedPrev}`,
      )
    }
  }
}
