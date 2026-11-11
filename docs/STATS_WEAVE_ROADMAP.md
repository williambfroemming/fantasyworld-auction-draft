# Weaving player stats into the site — Phase 5

The weekly NFL stat lines are loaded (`player_week_stats`, 16,532 rows, 2020–2026) and live on
Neon, but the site only shows them in two places: the best-week line and the hover detail on a
player's timeline. Everything else still talks in fantasy points alone. This phase puts the stats
where a member would actually reach for them.

Written 2026-11-11. Steps **67–75**. The checklist lives in `PROJECT_PLAN.md` §13 (section L).
Each step is written to be built on its own, in its own worktree, off `main`.

## What we are working with (verified 2026-11-11 against the data, not assumed)

| Fact | Number | Why it matters |
|---|---|---|
| Stat rows | 16,532 across 2020–2026; 627 players, 624 of whom played | The whole set is small; every page can read it with one indexed query |
| Rostered player-weeks with **no** stat row | 1,877 of 18,409 (about 10%) | Looked like a gap. **It is not**: every one of the 1,877 scored exactly 0 fantasy points. They are byes and inactives |
| Rows with `gp` null | 64–195 per season | Rostered, in Sleeper's file, did not play. Also 0 points |
| Rows with `gp >= 1` | 2,299–2,474 per full season (2020–2025) | The weeks that count |
| Worked example | CeeDee Lamb 2023, weeks 1–14: 13 games, 96 rec on 131 tgt, 1,253 yd, 8 TD | A season total is a sum over `gp >= 1` weeks only |
| Positions present | QB, RB, WR, TE, DEF (no K) | Column sets are per position; no kicking anywhere |

**The trust rule that follows:** a season total sums the weeks with `gp >= 1`; "games" is the count
of those weeks; a week with no row is "did not play", which the 1,877-zero-points check shows is
safe to treat as absent. Never print a 0 for a week that has no row.

**What the table can never say.** It holds rostered players only, in the weeks they were on a
league roster (the same weeks as `player_weeks`). So every figure is **"while rostered in this
league, since 2020"**, never a player's NFL season or career. Every panel that shows one carries
an `EraBadge` and says so. This is the same wording the Oracle is already told to use.

## Where it fits: the site, page by page

| Page | Shows about players today | Stats fit? | Plan |
|---|---|---|---|
| **Player page** `/history/players/[id]` | Fantasy points, playoff split, who rostered him, auction price, a timeline whose hover shows one week's stat line | **Yes, strongly.** It is the one page about a single player and has no totals | Steps 67, 68 |
| **Players index** `/history/players` | A name search over everyone, ordered by total fantasy points | **Yes.** No way to browse by position or season, or to see anything but points | Step 69 |
| **Records** `/history/records` (Players section) | Best week, best bench week, bench-in-a-loss, most weeks started, best season per position (all in fantasy points) | **Yes.** The natural home for "most receiving yards in a season" | Step 70 |
| **Spend & Value** `/stats`, **Past Auctions** `/history/drafts` | Price against fantasy points, per position | **Yes.** "What did that $66 actually do?" is the most-asked auction question | Step 71 |
| **Member page** `/history/members/[id]` | Favourite players (weeks started), draft DNA, points by position | **A little.** A list of this manager's biggest weeks, with the stat line | Step 72 |
| **Waivers** `/history/waivers` | Claims with the started points they earned | **Yes.** "He cost $47 and gave us 4 catches" | Step 73 |
| **Front page** (season underway) | Season table, points by position, FAAB left, playoff odds | **One panel.** The week's biggest starter performances, with stat lines. Only while a season is on | Step 74 |
| **Oracle** `/oracle` and the Ask launcher | Already knows the stats (step 65) | **Discoverability.** Nobody knows it can answer these now | Step 75 |
| Season review cards (Records) | "Best pickups" with points | Marginal. Folded into step 73's helper if it is cheap, otherwise left | — |
| Charts, Ratings, Head to Head, By Week, League Summary | Managers, not players | No | — |
| **The Gazette** | A snapshotted fact pack the writer is grounded on | **Deliberately not in this phase** | See "Left out on purpose" |
| **Draft room, Board, Trades** | The live auction | **Deliberately not** | See "Left out on purpose" |

## Left out on purpose

- **The Gazette.** Its fact pack is snapshotted, versioned with the prompt, and audited by
  `ungroundedNumbers()` as a publish gate. Adding stats means new pack fields, a prompt-version
  bump and new grounding tests; and a model handed yardage will write about yardage. That is a
  separate decision for the commissioner, not a side effect of a page change.
- **The draft room.** Two reasons, and either alone is enough. (1) Nothing may be added to
  `/api/state` or the polling fingerprint (`AGENTS.md`). (2) The table only covers players who
  were on a league roster, so a lot card showing "last season" would be blank or partial for
  every rookie and every free agent: a confident wrong answer at the moment it matters most.
  Doing it properly needs a full NFL stats pull, which this project already decided against
  (see `PLAYER_STATS_ROADMAP.md`, "Considered and rejected").
- **Derived efficiency numbers** (yards per target, catch rate, touchdown rate). Not until the
  raw totals have been on the site a while and are trusted. When added, each needs a glossary
  entry and a within-position comparison.
- **Kicking, and any NFL career total.** No data.

## Rules that apply to every step here

All the rules in `docs/ANALYTICS_ROADMAP.md` ("Rules that apply to every step") and
`docs/PLAYER_STATS_ROADMAP.md` still hold. The ones that matter most here:

- **Group on the player's own `position`, never the lineup slot.** A WR in FLEX is a WR.
- **Compare within a position, never across.** A list ranked by yards is ranked inside one
  position. There is no "most yards, all positions" list, and **a sort by a stat is only offered
  when a position is selected** (step 69). Add a unit test at every new site.
- **Null is unknown; zero is a real zero.** A week with no row is absent. A played week with no
  catches is a real `0 rec`. See the trust rule above.
- **Every figure is "while rostered in this league".** `EraBadge` on every panel
  (`coverage.label` something like "Stat lines"), and the sentence in the panel.
- **These are NFL stats, not fantasy points.** Fantasy points stay in `player_weeks.points`. Never
  show the two in a way that invites adding or comparing them.
- **Regular season and playoffs are split on that season's own `seasons.playoff_week_start`**
  (it was week 14 in 2020 and 15 from 2021), never a hardcoded week. The player page already does
  this for points; reuse how.
- **Derivations are pure functions in `src/lib/` with a test beside them.** Pages read through
  `src/server/history-service.ts`. Nothing here adds a `fetch(`, and nothing here touches
  `/api/state` or `src/lib/version.ts`.
- **No new migration.** Every step reads `player_week_stats`, `player_weeks` and `seasons`, which
  are already on Neon. So the order of shipping is just "merge, deploy".
- A step is done when its **Done when** passes, the `docs/PROGRESS_LOG.md` entry is written
  (with **Learned** and **Watch out for**), the box is ticked, and code and docs are one commit.

## How to work a step

Identical to `docs/ANALYTICS_ROADMAP.md` "How to work a step". In short: read `AGENTS.md`; read the
step; read the files it names (the code wins over this file); read the relevant guide in
`node_modules/next/dist/docs/` before writing a route or page; work in your **own worktree**
(`git worktree add .claude/worktrees/<name> -b <branch> origin/main`, with a **cloned**, not
symlinked, `node_modules`); use local Postgres only (`npm run db:local:up`, then
`npm run local -- <cmd>`, `npm run dev:local -- -p <free port>`, **never** `npm run dev`); and
verify the page against direct SQL, not just fixtures. Steps 67 → 68 depend on each other; after
step 67 the rest are independent and can run in parallel in separate worktrees.

---

## Step 67 — the foundation: season stat totals on the player page

This is the step everything else leans on. Build it first and build it well.

**Read first:** `src/lib/player-stats.ts` (`STAT_KEYS`, `formatStatLine`, `isTeamDefenseId`),
`getPlayerHistory()` and `PlayerSeasonLine` in `src/server/history-service.ts` (the per-player
stats read is already there, near the "empty map on 42P01" comment), `src/components/history/PlayerTimeline.tsx`,
and `src/app/history/players/[playerId]/page.tsx`.

**Create** `src/lib/player-stat-totals.ts`, pure, with a test beside it:

- `statColumns(position)`: the ordered columns to show for a position, with a label and a
  precision. QB: games, completions/attempts, pass yd, pass TD, INT, sacks taken, rush yd,
  rush TD. RB: games, rush att, rush yd, rush TD, targets, receptions, rec yd, rec TD.
  WR and TE: games, targets, receptions, rec yd, rec TD, rush yd. DEF: games, sacks, INT,
  fumble recoveries, defensive TD (`def_td + def_st_td`), points allowed per game. A secondary
  group is shown only if it is non-zero for that player (a WR with no rushing shows no rushing
  column), the same rule `formatStatLine` already follows. Fumbles lost on any offensive player.
- `sumStats(rows)`: totals over rows where `gp >= 1`; `games` is their count; a row with null
  `gp` contributes nothing. Returns `null` for a stat that no played row had a value for.
- `seasonStatTotals(rows, playoffStarts)`: per season, split into `regular` and `playoff` on
  that season's own `playoff_week_start`, plus a `career` total.

**Tests:** a week with no row contributes nothing and is not counted as a game; a played week with
no catches counts as a game and as 0 receptions; null `gp` is not a game; the regular/playoff split
follows each season's own boundary (2020 week 14, 2021 week 15); a defence gets the defence group
and a WR gets none of it; a position never receives another position's columns; secondary groups
appear only when non-zero.

**Page:** under the existing season table on the player page, a "Stats by season" table for his
position's columns, one row per season plus a career row, with a Regular / Playoffs toggle that
defaults to regular season. `EraBadge` (label "Stat lines") and one sentence: "Counts only the
weeks he was on a roster in this league, from 2020." Glossary entry `stat-totals`. A player with no
stat rows at all shows no table and says nothing (the page already does this for the timeline).

**Done when:** `npm test` passes; the Lamb 2023 regular-season row on the page reads 13 games, 96
rec, 131 tgt, 1,253 yd, 8 TD and equals a hand-written SQL sum over `player_week_stats` joined to
`player_weeks` (weeks 1–14, `gp >= 1`); the page looks right at 390px (the table scrolls inside its
own container) and on a defence page; the unmigrated-table path still renders the page without the
table.

**Stop and report if** any rostered player-week with points but no stat row turns up (the data
check says there are none; if one appears the whole null/zero rule needs revisiting).

## Step 68 — the player page: game log

**Read first:** step 67's helpers, `PlayerTimeline.tsx`, and how `weekly` is built in `getPlayerHistory`.

A collapsible game log under the stats table: one row per week he was rostered, newest season
first, grouped by season in `<details>` (latest season open): week, opponent-free (we do not store
the NFL opponent, so do not invent one), who rostered him, started or benched, fantasy points, and
the stat line from `formatStatLine`. A week with no stat row prints "did not play" only when
fantasy points were 0, otherwise the row prints a dash, so a gap can never read as an answer.

Also: make the timeline's y-axis switchable between fantasy points and the position's headline stat
(QB pass yd, RB scrimmage yd, WR/TE rec yd, DEF sacks). Two lines on one axis is out; it is one
metric at a time, labelled.

**Tests:** headline stat per position; a bench week is labelled bench; "did not play" never shows
for a week with non-zero points.

**Done when:** the log for one real player matches SQL row for row for one season; the timeline
toggle changes the axis label and values and nothing else; keyboard focus works on the toggle.

## Step 69 — the players index: filter by position and season, with one stat

**Read first:** `src/app/history/players/page.tsx`, `src/components/history/PlayerSearch.tsx`,
`listPlayers()` in `history-service.ts`, and `statColumns()` from step 67.

Add a position filter (All, QB, RB, WR, TE, DEF) and a season filter (All 2020 on, or one season)
to the existing search. When a season and a position are both chosen, show one **headline stat**
column for that position (QB pass yd, RB rush yd, WR/TE rec yd, DEF sacks) and allow sorting by
it. Default sort stays total fantasy points.

**The rule that makes this safe:** the stat column and the stat sort exist **only when exactly one
position is selected.** With "All" selected there is no stat column and no stat sort, because a
list ranked by yards across positions measures nothing. Add a unit test that the sort-by-stat
option is not offered for "All", and one that a mixed-position list is never ordered by a stat.

`listPlayers()` stays one query: add a second small query for the chosen season's headline totals
(≈600 players × 7 seasons), keyed by player id, joined in memory. Filtering runs on the client over
the data the page already sends; do not add an API route for it.

**Done when:** QB / 2023 sorted by pass yards equals a direct SQL ranking for the same filter;
"All" shows no stat column; the page is still fast with the full list (it is a few hundred rows);
390px layout checked.

## Step 70 — Records: stat records within a position

**Read first:** `src/lib/player-records.ts` and its test, `PlayerRecordsSection.tsx`, step 67's
`sumStats`.

Extend `playerRecords()` (or a sibling `playerStatRecords()`, if that keeps the existing file
simple) with top-five lists, regular season, rostered players, one list per position and stat:

- QB: passing yards in a season, passing touchdowns in a season, passing yards in a game.
- RB: rushing yards in a season, rushing + receiving yards in a season, rushing yards in a game.
- WR and TE: receiving yards in a season, receptions in a season, receiving yards in a game.
- DEF: sacks in a season, points allowed in a game (fewest).

Each entry names the manager who had him, as the existing lists do, and a season entry is one
manager's stint (same rule as "Best season, by position": a player who changed hands appears once
per holder with only his own weeks). Show them as one `<details>` block per position under the
existing Players section, with the `EraBadge` "Stat lines, rostered players".

**Tests:** every list is ranked within its position and contains only that position; a bench week
is excluded from the single-game lists only if the list says "by a starter" (decide and state it;
the recommendation is to count only started weeks, since a bench stat line won nothing); a tie keeps
the earliest; no list mixes positions.

**Done when:** each list's first entry equals a direct SQL maximum; the lists are readable at 390px.

## Step 71 — Spend & Value and Past Auctions: what the pick returned

**Read first:** `src/components/stats/ValuePanel.tsx`, `src/server/archive-service.ts`,
`src/app/stats/page.tsx`, the pick's `player_sleeper_id` (snapshotted on `picks`), and
`draftersByPick()` in `src/lib/stats.ts`.

For an archived auction, add to each pick's detail the player's regular-season stat line **for
that season** ("$66 · 1,253 yd, 8 TD in 13 games"). The join is by `picks.player_sleeper_id` and
`season` to `player_week_stats`, never through the live `players` table (an archive never joins the
pool; `picks` already carries what it needs). A pick with a null `player_sleeper_id` shows no stat
line, not an error: null is unknown.

Money still attributes to the drafter via `draftersByPick()`. The bargain/overpay views keep
comparing **within a position**; this step adds a line of text to each pick and changes no ranking.
Because the stats cover only the weeks the player was rostered, say so ("while rostered, since
2020"); a drafted player is rostered by the manager who drafted him in week 1, so for a drafted
player the stat line is nearly the full season in practice, but the sentence stays.

**Done when:** two real picks (one WR, one QB) show a line equal to SQL; a pick with a null
sleeper id shows none; the existing value rankings are byte-for-byte unchanged (add a test that
the ranking function's output does not depend on whether stats are supplied).

## Step 72 — the member page: biggest weeks

**Read first:** `src/app/history/members/[id]/page.tsx`, `getFavoritePlayers`/`getMostStarted`,
`formatStatLine`.

Under "Favourite players", add "Biggest weeks": this manager's five highest fantasy-point **started**
player-weeks, each with the player, week, points and the stat line behind it. Highest-points is a
plain statement about points scored, so it may span positions, as the single-week record does; the
stat line is just the explanation. `EraBadge` for the stat lines.

**Done when:** the five rows equal a direct SQL top five for one manager; a manager with no weekly
data shows nothing (the page already hides sections for them).

## Step 73 — Waivers: what a claim did

**Read first:** `src/lib/faab.ts` (especially how each weekly row is credited to the latest
acquisition before it), `getFaab()` in `history-service.ts`, `FaabTables.tsx`.

A won claim already carries `pointsStarted` and `weeksHeld`. Add `statsSince`: the claimed player's
totals over exactly the weeks credited to that claim (use the same crediting, so a player claimed,
dropped and re-added is never double counted), shown as the position's headline stats ("12 rec,
140 yd, 1 TD since pickup"). Extend the weekly query in `getFaab()` to join the stat rows for those
weeks; it is already restricted to players ever won on waivers, so it stays small.

**Tests:** stats follow the same credited weeks as points; a re-acquired player's later weeks are not
credited to the earlier claim; a claim with no counted weeks shows no stats, not zeros.

**Done when:** Joe Burrow 2025 (claimed week 10, $46) shows the passing totals for weeks 11–14 only and
matches SQL for those weeks.

## Step 74 — the front page: the week's biggest starts (season underway only)

**Read first:** `src/app/page.tsx` (the `seasonUnderway` gating and the existing panels),
`src/components/season/`, `completeWeeks()` in `src/lib/season-so-far.ts`.

While a season is being played, add a small panel under the season table: the five highest-scoring
**started** players of the latest completed week, each with the position, who started him, the
points and the stat line. It reads only completed weeks (the same `completeWeeks` the other panels
use, so it never shows a half-played week) and appears only when `seasonUnderway` is true, like the
FAAB panel. It must not add a request to anything polled, and it must survive a database without
the stats table (no panel, not a 500).

**Done when:** the panel for a stood-in finished season (`/?preview=2025&through=8`, behind a
temporary demo page, since the front page needs a session) equals SQL for that week; it is absent
out of season.

## Step 75 — the Oracle, the glossary and the sign-off

**Read first:** `src/components/OracleBar.tsx`, `src/components/OracleLauncher.tsx`,
`src/lib/oracle-schema.ts` (the rules), `src/lib/glossary.ts`, `docs/UAT.md`.

- **Suggested questions** in the Oracle launcher and page: three or four chips that exercise the
  stats and FAAB ("Who had the most receiving yards in 2023?", "What did Bryan's biggest waiver claim
  of 2025 return?"). They only fill the input; the member still presses Ask. They never run on page
  load and add no request. Draw them from a short constant list in `src/lib/`, with a test that
  every chip is a plain string under a length cap.
- **Glossary:** an entry for every new term introduced in steps 67–74 (stat totals; games; headline
  stat; "while rostered"), each naming its source function.
- **UAT:** a new lettered section in `docs/UAT.md` covering the checks a member would do by eye on
  each new surface.
- Re-run the user's step 44 ("ask about twenty real questions") with a handful of stat questions
  added, and feed any misses into `ORACLE_RULES`.

**Done when:** the chips appear in both Oracle surfaces and fill (not submit) the box; the glossary
test (if one exists for source names) passes; UAT section is in.

---

## Order and shipping

1. **67 then 68** (same page, 68 reuses 67). Ship these together; it is the biggest visible win.
2. **69, 70, 71** are independent of each other; do them in any order, in parallel if wanted.
3. **72, 73, 74** are small and independent.
4. **75** last.

Every step is code only. No migration, no backfill, nothing to run on Neon. Ship each as its own
PR; each can be reverted on its own.

## Decisions for the commissioner (none block steps 67–68)

1. **Single-game stat records: started weeks only, or any rostered week?** Recommended: started
   only, because a bench stat line won nothing. (Step 70.)
2. **Should the Gazette ever be given stats?** Recommended: not now; revisit after the pages have
   been used for a month. It is a prompt, grounding and cost decision, not a page.
3. **Do you want the draft room to show last season's line for the 2027 auction?** Recommended: no
   with this table (see "Left out on purpose"). If wanted, it is a separate project that starts with
   a full NFL stats pull.
