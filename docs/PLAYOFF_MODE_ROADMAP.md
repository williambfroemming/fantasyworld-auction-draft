# Playoff Mode Roadmap — the front page in weeks 15–17 (section O, steps 86–91)

**Status: planned 2026-11-13. Step 86 done 2026-11-14 (contract committed, checks answered in section 4).** Supersedes the parked note in
`docs/BACKLOG.md` §12.

**Deadline.** The 2026 regular season ends with week 14 and the bracket starts in week 15
(`playoff_week_start: 15`, six teams, two byes). Playoff mode has to be live before the Tuesday
import that follows week 14, which should be **Tuesday 2026-12-15** (confirm against the NFL
calendar). After that date the front page freezes at "Through week 14" until this ships.

**Numbering.** Steps 86–91 assume nothing else lands first. If another branch takes those
numbers, renumber at merge the way the Gazette room was (`docs/PROJECT_PLAN.md` §13).

Self-contained build plan, written to be run by **one orchestrator and several agents working
in parallel worktrees**. Every agent reads `AGENTS.md` before starting. Section 6 is the
breakdown; section 5 is the contract that lets the parallel units work without waiting on each
other.

---

## 1. Why

From the first completed week until a champion is crowned, `/` leads with the season table
(`SeasonSoFarPanel`, `lead`). `seasonSoFar()` counts regular-season games only, which is correct:
all-play, the median game and schedule strength are whole-field measures and a bracket week has
four to six teams in it. So for three weeks the largest thing on the page stops moving while the
real news is the bracket. The playoff odds panel also has nothing left to say once the field is set.

## 2. What ships

| Piece | What the reader sees |
|---|---|
| Bracket lead | Six seeds, two byes, scores on played games, the current round marked pending, losers dimmed |
| Matchup cards | One per current-round game: seed, record, points per game, this season's meeting, all-time playoff meetings |
| Title odds and win probability | A title percentage per team still alive and a win percentage per pending game |
| Stakes | Prize money when on record; each contender's titles and playoff appearances ("would be a first title") |
| Final regular-season table | The season table, demoted below the bracket, retitled, with an honours row |

Not in scope: the consolation bracket, a championship-week poster, live scores, an extra
import on Monday night. Park those in `docs/BACKLOG.md` if they come up.

## 3. Locked decisions

| Decision | Reason |
|---|---|
| **Playoff mode is derived, never switched.** On when every regular-season week is complete and the newest season has no champion. | The monument already returns on its own when the import sets `champion_manager_id`. Nothing may need turning off by hand in January. |
| **`seasonSoFar()` is not touched.** Playoff games stay out of all-play, median and schedule strength. | Putting them in silently changes what every column means (`BACKLOG.md` §12). |
| **Pending rounds are derived, not stored.** Seeds are wins then points for; the shape is `bracketOrder()` / `byesFor()` (fixed bracket, not re-seeded). | The import writes a playoff game only once it has been played, so there is no stored row for a round in progress. |
| **A contradiction draws no bracket.** If a stored playoff row disagrees with the derived pairing, `playoffBracket()` returns null and the page keeps today's table lead. | A manual re-seed or an odd tiebreak must not produce a confident wrong bracket. |
| **The frozen odds stream is not touched.** Bracket odds get their own seeded generator. | `playoffPct`, `byePct` and `projectedWins` are published numbers. `playoff-odds-baseline.json` must pass unmodified and `npm run odds:backtest` must still print 0.159 / 0.192 / 0.240. |
| **Ratings come from the regular season only.** | It is the same "rating" shown everywhere else, and one or two playoff games (zero for a bye team) would add noise unevenly. |
| **Odds go through `formatOdds()`; an eliminated team gets no number.** | Never 100% or 0% while a game remains. Elimination is a fact, not a probability. |
| **Pending means pending.** A round being played shows the pairing, no score, and "through week N". | Nothing on a request path calls Sleeper. Results arrive with the Tuesday import. |
| **No new table, no migration, no outbound call.** Nothing here touches `/api/state`, the fingerprint, the Gazette or the Oracle. | Everything needed is already in `season_matchups` and `seasons`. |
| **The fifth-place game is not drawn.** The third-place game is, in the final round. | Third place pays; nobody tries in the fifth-place game (`schema.ts`, `playoff_placement`). |
| **`PlayoffOddsPanel` and `TopStartsPanel` are hidden in playoff mode.** `PositionalGrid` and `FaabLeftPanel` stay. | Both hidden panels freeze at week 14. |

## 4. What exists already

| Thing | Where |
|---|---|
| Front page and its lead swap (`seasonUnderway`) | `src/app/page.tsx` |
| Season report, odds and members in one call; `throughWeek` preview | `getSeasonSoFar()` in `src/server/history-service.ts` |
| Bracket shape, byes, the rating model, `formatOdds()` | `src/lib/playoff-odds.ts` |
| Playoff rows: `isPlayoff`, `playoffRound`, `playoffPlacement` (null = championship path, 3 = third place, 5 = fifth) | `HistoryMatchup` in `src/lib/history.ts`; written by `scripts/import-sleeper-history.ts` |
| "Counts toward records" playoff filter | `src/lib/history.ts` (near line 167) |
| Round labels for placement games | `src/lib/gazette.ts` (near line 600) — read for the rule, do not import the Gazette into the page |
| `seasons.regular_season_weeks`, `playoff_teams`, `champion_prize`, `runner_up_prize`, `third_prize` | `src/db/schema.ts` |
| Lead-variant heading styles | `src/components/season/SeasonSoFarPanel.tsx` |
| Preview: `/?preview=2025&through=N` | `src/app/page.tsx` — already feeds `throughWeek`, so 14, 15 and 16 preview each stage with no new parameter |
| Ground truth for tests | `data/sleeper/2025/winners_bracket.json` and the 2025 matchup files. Jack was the top seed; Gabes won it |

**Checked before building (step 86, 2026-11-14, local database):**

1. **Yes.** `seasons.regular_season_weeks` is 14 and `playoff_teams` is 6 for 2024, 2025 and
   2026. Local 2026 holds weeks 1–9, no champion.
2. **Yes.** 2025 weeks 1–14 are `is_playoff = false`, ten rows each. Week 15 is round one only
   (4 rows, placement null). Week 16 is round two: 4 championship-path rows **and 2 rows with
   placement 5** (the fifth-place game is played in round two, not the last round). Week 17 is
   round three: 2 rows placement null (the final; the bracket file's `p: 1` is stored as null)
   and 2 rows placement 3.
3. **Yes.** Wins then points for gives Jack 1 (9-5, 1820.38), Gabes 2 (9-5, 1795.42), Mario 3
   (8-6, 1976.78), Justin 4 (8-6, 1799.42), Bill 5 (7-7, 1826.74), Bryan 6 (7-7, 1785.66), and
   the same order as the win and points columns in `rosters.json`. `winners_bracket.json`
   (roster ids mapped through `managerIdForSleeperOwner`) agrees game for game: Justin v Bill
   (4 v 5) and Mario v Bryan (3 v 6) in round one; Jack v the 4-5 winner (Bill) and Gabes v the
   3-6 winner (Bryan) in round two; Gabes beat Jack in the final; Bill beat Bryan for third.
   Both ties on wins inside the field (1 v 2, 3 v 4, 5 v 6) were broken by points for, so the
   tiebreak is exercised, not just the win column.
4. **Yes, it is there.** `HistorySeason` carries `runnerUpManagerId` and `thirdManagerId`, and
   also the three prize columns, so step 91 does not need to extend the `seasons` SELECT. The
   runner-up is on record from 2011 (2006–2010 have a champion's name only). The contract
   gained `TeamContext.lastFinal` for it: null means "none on record", never "never played in one".

Also found: the local `seasons` rows for 2025 and 2026 have no prize money (2024 does), so the
stakes line prints no dollars in any 2025 preview. That is the null-prize rule working, not a bug.

## 5. The contract

Step 86 commits this file of types first. Every later unit imports from it, which is what lets
steps 87–90 run at the same time.

`src/lib/playoff-types.ts` (types only, no logic):

```ts
export interface BracketTeam {
  managerId: number
  seed: number            // 1-based
  wins: number
  losses: number
  ties: number
  pointsFor: number
}

export interface BracketSide {
  managerId: number | null       // null until the feeder game is played
  seed: number | null
  points: number | null          // null until played
  /** Set when managerId is null: the seeds whose game decides this side. */
  winnerOf: [number, number] | null
}

export interface BracketGame {
  id: string                     // stable, e.g. "r2-g1"
  round: number                  // 1-based
  week: number                   // regularSeasonWeeks + round
  placement: null | 3            // null = championship path, 3 = third-place game
  a: BracketSide
  b: BracketSide
  status: 'played' | 'pending' | 'waiting'   // waiting = a side is still unknown
  winnerManagerId: number | null
}

export interface PlayoffBracket {
  season: number
  teams: BracketTeam[]           // seed order
  byes: number[]                 // managerIds with a first-round bye
  rounds: BracketGame[][]        // index 0 = round one
  /** Last week with results on record: a playoff week, or the last regular week. */
  throughWeek: number
  /** First round with a game not yet played. Null when the bracket is decided. */
  currentRound: number | null
  alive: number[]                // managerIds still able to win the title
  championManagerId: number | null
}

export interface BracketOdds {
  simulations: number
  /** Games left on the championship path. Passed to formatOdds(). */
  gamesRemaining: number
  title: Array<{ managerId: number; titlePct: number }>          // alive teams only
  games: Array<{ gameId: string; aWinPct: number }>              // pending games only
}

export interface TeamContext {
  managerId: number
  titles: number                 // counted by display name, as page.tsx does
  playoffAppearances: number
  /** Most recent championship game in a completed earlier season. Null = none on record (runner-up known from 2011). */
  lastFinal: { season: number; won: boolean } | null
}

export interface PairContext {
  gameId: string
  /** This season's regular-season meetings, from a's side. */
  thisSeason: Array<{ week: number; aPoints: number; bPoints: number }>
  /** All-time playoff meetings that count toward records. */
  playoffMeetings: { aWins: number; bWins: number; last: { season: number; winnerManagerId: number } | null }
}

export interface PlayoffPicture {
  bracket: PlayoffBracket
  odds: BracketOdds | null
  teams: TeamContext[]
  pairs: PairContext[]           // current-round games with both teams known
  prizes: { champion: number | null; runnerUp: number | null; third: number | null }
}
```

An agent that needs the contract changed says so in its report and does not edit the file.
The orchestrator makes the change and tells the other agents.

## 6. Units of work

```
86 contract ──┬─▶ 87 bracket ─────────┐
              ├─▶ 88 odds ────────────┤
              ├─▶ 89 context ─────────┼─▶ 91 integrate, verify, docs
              └─▶ 90 components ──────┘
```

| Wave | Step | Unit | Runs | Owns (nobody else edits these) |
|---|---|---|---|---|
| 0 | 86 | Contract and checks | Orchestrator, on the feature branch | `src/lib/playoff-types.ts`, this file's section 4 checks |
| 1 | 87 | Bracket derivation | Agent, own worktree | `src/lib/playoff-bracket.ts`, `playoff-bracket.test.ts` |
| 1 | 88 | Bracket odds | Agent, own worktree | `src/lib/playoff-odds.ts` (extraction only), `src/lib/playoff-bracket-odds.ts` + test |
| 1 | 89 | Context for the cards | Agent, own worktree | `src/lib/playoff-context.ts` + test |
| 1 | 90 | Components | Agent, own worktree | `src/components/season/PlayoffBracketPanel.tsx`, `SeasonSoFarPanel.tsx`, `src/components/season/__fixtures__/playoff-picture.ts` |
| 2 | 91 | Integrate, verify, docs | Orchestrator | `src/server/history-service.ts`, `src/app/page.tsx`, `src/lib/glossary.ts`, all of `docs/` |

Rules for the wave-1 agents:

- Branch from the step 86 commit. Edit only the files you own.
- **Do not edit anything under `docs/`.** `PROGRESS_LOG.md` is append-only and four parallel
  appends will conflict. Put your log entry (what was built, **Learned**, **Watch out for**) in
  your final report, written when you finish and not reconstructed later. The orchestrator
  appends it when it merges your branch.
- Finish with `npm test` and `npx tsc --noEmit` passing, and commit.
- No database is needed for 87, 88 or 89: they are pure functions tested against committed data.

### Step 86 — contract and checks (wave 0)

1. Create the feature branch off `main`.
2. Run the four checks in section 4 against the local database (`npm run db:local:up`, then
   `npm run local -- …`). Record the answers in this file.
3. Commit `src/lib/playoff-types.ts` exactly as in section 5, adjusted for anything the checks found.
4. Add steps 86–91 to `docs/PROJECT_PLAN.md` §13.

Done when: the types compile and the checks are answered.

### Step 87 — bracket derivation (wave 1)

`playoffBracket(input: { season; matchups: HistoryMatchup[]; playoffTeams; regularSeasonWeeks }): PlayoffBracket | null`

- `matchups` arrives already truncated to the week being shown. Never read past it.
- Null unless every regular-season week through `regularSeasonWeeks` is complete. Use
  `completeWeeks()` from `src/lib/season-so-far.ts` so "complete" means what the table means.
- Seeds: wins, then points for, over regular-season rows.
- Shape: `bracketOrder()` and `byesFor()` from `src/lib/playoff-odds.ts`. Round `r` is week
  `regularSeasonWeeks + r`.
- Results: stored playoff rows with `playoffPlacement === null`, plus the third-place game
  (`3`) in the last round. Ignore `5`.
- Return null when a stored row contradicts the derived pairing.

Tests, from the committed 2025 season truncated to weeks 13, 14, 15, 16 and 17:
13 gives null; 14 gives seeds and byes with round one pending; 15 and 16 fill scores and
advance winners; 17 names the champion and the third-place result; all of it agrees with
`data/sleeper/2025/winners_bracket.json`. Plus a contradiction case returning null.

### Step 88 — bracket odds (wave 1)

1. In `src/lib/playoff-odds.ts`, lift the rating maths (league mean, `sigma`, shrunk rating,
   `ratingSd`) into an exported `teamRatings(played)` that **draws no random numbers**, and
   have `playoffOdds()` call it. Change nothing else in that file.
2. `bracketOdds(bracket: PlayoffBracket, ratings, season): BracketOdds | null` in
   `src/lib/playoff-bracket-odds.ts`. Simulate from the bracket's actual state, played games
   fixed, 10,000 times, each game two draws around a per-simulation true rating (the model
   `playBracket()` uses). Seed its own generator from season, `bracket.throughWeek` and a new
   constant. Null when the bracket is decided.

Done when: `playoff-odds.test.ts` passes with `__fixtures__/playoff-odds-baseline.json`
**unmodified** (if it fails, find the stray draw; do not regenerate the fixture);
`npm run odds:backtest` prints 0.159 / 0.192 / 0.240; and new tests show alive teams' title
odds sum to 1, eliminated teams are absent, two calls agree exactly, and a team that has
already won its semi-final has no pending-game entry for it.

This agent can build a `PlayoffBracket` by hand for its tests and does not need step 87.

### Step 89 — context for the cards (wave 1)

Pure functions in `src/lib/playoff-context.ts`:

- `teamContext(...)`: titles and playoff appearances per manager. Titles are counted by
  **display name**, the way `src/app/page.tsx` counts the reigning champion's, so the
  2006–2010 name-only champions are not dropped. Appearances come from `season_standings`
  (`made_playoffs`), completed earlier seasons only.
- `pairContext(...)`: this season's regular-season meetings and all-time playoff meetings for
  each current-round game with both teams known. Use the existing "counts toward records"
  filter so fifth-place games are excluded. Nothing after the bracket's `throughWeek`.

Tests against committed history: a pair with a known playoff meeting, a pair with none, and a
manager with early name-only titles.

### Step 90 — components (wave 1)

Build against a hand-written `PlayoffPicture` fixture (one for "round one pending", one for
"final pending"). No data fetching in this unit.

- `PlayoffBracketPanel` (server component), props `{ picture: PlayoffPicture; members }`:
  - Lead heading in the same display type as `SeasonSoFarPanel`'s `lead` variant: "The playoffs",
    then "through week N" and a short note that results arrive with Tuesday's update.
  - Three rounds; byes labelled; scores on played games; pending games marked; losers dimmed;
    a waiting side reads "winner of 4 v 5".
  - A card per current-round game: seed, record, points per game, win probability, title odds,
    this season's meeting, playoff history, titles ("would be a first title" at zero).
  - A stakes line. A null prize is not printed.
  - Rounds stack vertically at phone width; no horizontal page scroll.
  - Odds printed only through `formatOdds(p, odds.gamesRemaining)`.
- `SeasonSoFarPanel`: a `final` prop. The non-lead heading becomes "Final regular-season table"
  and an honours row is added (top seed, most points, best all-play), from `report.rows`.
  Behaviour without the prop is unchanged.
- Member names and colours the way the other season panels take them. Read
  `docs/archive/SITE_STRUCTURE.md` only if the nav is touched (it should not be).

Done when: both fixtures render in light and dark themes at desktop and phone width (a
throwaway route is fine for looking; do not commit it).

### Step 91 — integrate, verify, docs (wave 2)

1. Merge 87–90 in that order. Append each unit's log entry to `docs/PROGRESS_LOG.md` and flip
   its box in `PROJECT_PLAN.md` §13 as it merges.
2. `getSeasonSoFar()`: add `playoffs: PlayoffPicture | null` to the return value, built from
   what the function already holds (truncated matchups, the `seasons` row, members). Extend the
   existing `seasons` SELECT with the three prize columns. Null whenever `playoffBracket()` is null.
3. `src/app/page.tsx`: when `seasonUnderway && soFar.playoffs`, draw `PlayoffBracketPanel` as
   the lead, then `SeasonSoFarPanel` with `final`, then `PositionalGrid` and `FaabLeftPanel`.
   Do not draw `PlayoffOddsPanel` or `TopStartsPanel`. Otherwise the page is exactly as today.
   Delete the step 90 fixture if nothing else uses it.
4. Glossary entry for title odds and win probability beside the existing playoff-odds entry.
5. Verify (section 7).
6. Docs: step 91's own log entry; move `BACKLOG.md` §12 to `docs/archive/BACKLOG_SHIPPED.md`
   with the one-line pointer the other shipped sections use; move this roadmap to
   `docs/archive/` and add a row for it in `AGENTS.md`; add a short non-negotiable to
   `AGENTS.md` for the two rules a future change is most likely to break (derived not switched;
   the bracket odds never touch the frozen stream).

## 7. Verification

1. `npm test`, `npx tsc --noEmit`, `npm run lint`.
2. `npm run odds:backtest` — Brier 0.159 / 0.192 / 0.240.
3. `npm run db:local:up`, `npm run dev:local` (never `npm run dev`), then:

| URL | Expect |
|---|---|
| `/` | Unchanged: 2026 table lead (the season is mid-way) |
| `/?preview=2025&through=13` | Unchanged table lead |
| `/?preview=2025&through=14` | Bracket lead; Jack the top seed; two byes; round one pending; odds shown |
| `/?preview=2025&through=15` | Round one scores; semi-finals pending; odds moved; losers dimmed |
| `/?preview=2025&through=16` | Final pending between the two finalists; third-place game pending |
| `/?preview=2025&through=17` | Decided bracket, Gabes champion, no odds |

4. Phone width on each of the bracket URLs.
5. After deploy, and again on the Tuesday after week 14: the live page flips on its own. On the
   Tuesday after the final: it flips back to the champion monument on its own.

## 8. Risks

| Risk | What to do |
|---|---|
| Wins-then-points-for does not reproduce Sleeper's seeds | Caught by check 3 in step 86, before anything is built on it |
| A tie in a playoff game, or a forfeited one | The contradiction rule returns null and the page falls back to the table. Acceptable; note it in the log |
| The week-14 import runs before every game is final | `completeWeeks()` and the importer's own completeness test already guard this; playoff mode simply starts a week later |
| `through=17` preview has a champion, so the live page would show the monument, not a decided bracket | The preview forces `seasonUnderway`; the decided-bracket state exists for the preview and for the hours between the final import and the champion being set. Make sure it renders sensibly, with no odds |
| Four worktrees drift from the contract | The types file is owned by the orchestrator; agents report, they do not edit |
