# Backlog — 2027 season and beyond

> **Nothing in this file is for draft night.** This is the parking lot for ideas
> that arrive mid-build and mid-draft, so they don't turn into a risky change on
> a deadline. Read `PROJECT_PLAN.md` for the durable spec first — the
> non-negotiables in §4 constrain most of what's below.

Add to this freely. An item here costs nothing; the same item attempted in
August costs the draft.

**Section numbers are load-bearing.** Roughly a dozen source comments cite
`docs/BACKLOG.md §N` (`src/lib/draft.ts`, `src/server/queue-service.ts`,
`src/components/LotPanel.tsx`, …). Sections that ship are moved whole to
`docs/archive/BACKLOG_SHIPPED.md` under the same number and leave a one-line stub
here — **never renumbered and never deleted.**

---

## What is actually open

| # | Item | Size |
|---|---|---|
| §8 | Accessibility — the rest of it | A session |
| §8 | Push rosters to Sleeper | Unspecified |
| §12 | What the front page leads with during the playoffs | Small |
| §13 | Folding the record-by-week history into the playoff odds | Offseason, on evidence |
| §14 | Analytics ideas not chosen for Phase 3 | Parked |
| §15 | Player stats — what Phase 4 left out | Parked |

The analytics work that *was* chosen is not backlog — it is scheduled, in
`docs/ANALYTICS_ROADMAP.md`.

---

## Shipped — full text in `docs/archive/BACKLOG_SHIPPED.md`

One line per section so every `§N` cited in the source still resolves.

- **§1.** Player news feed — injury status shipped (step 26), the headline feed built and cut the same day. **Read the archived section before adding a feed back.**
- **§2.** Draft history, every season kept and browsable — shipped, steps 17 and 25.
- **§3.** Average remaining budget — shipped, step 18.
- **§4.** Personal player queue — shipped, steps 18 and 23.
- **§5.** "On deck", who nominates next — shipped, step 18.
- **§6.** Drafted players and prices by position — shipped, step 18.
- **§7.** Team spend analysis — shipped, steps 19 and 22.
- **§9.** From draft night 2026 (the stall, complete-vs-stuck, the cursor bug) — all three fixed, steps 18 and 21.
- **§10.** Chalk Talk, the visual direction not taken — not open work; the palette is kept on file in the archive.
- **§11.** Landing page — shipped, step 31.

---

## 8. Also raised, not yet specified

**PARTLY BUILT 2026-09-07** — `PROGRESS_LOG.md` step 35. The nav is fixed and the
accessibility pass has started. What is left is listed below.

⚠️ **The mobile item was described wrongly here for months, and the wrong
description is what kept it alive.** This file said "the nav header overflows
below roughly 700px on *every* page, which was confirmed while building §11".
That is not true and was not true then: every header is `flex-wrap`, the draft
page stacks at `lg:`, and the wide tables are inside `overflow-x-auto`. The real
fault was in the same component — the section menus opened on hover only, so on
a phone they could not be opened at all — and it was invisible to the obvious
test, because narrowing a desktop window leaves you a mouse. **A backlog note
specific enough to sound verified will not get re-checked.**

| Item | Note |
|---|---|
| ~~Mobile / tablet layout~~ | ✅ **CLOSED** for the nav — `<details>` menus, reachable on touch, plus the panel positioning that stops the rightmost menu opening off-screen. The rest of the app was checked while doing it and is in better shape than this file implied. If the *draft room* is ever used on a tablet, the League grid and the award controls are still the two things to re-check — that page is built for a laptop on purpose. |
| Push rosters to Sleeper | Today the draft ends at a CSV (`/api/export`). Pushing results into Sleeper directly would need league write auth — a much bigger ask than the read-only pool sync. Note this is *not* the archive: §2 supersedes exporting-as-preservation. |
| Accessibility pass | 🟡 **STARTED.** Shipped: a skip link on every page (`id="main"` on all 28 `<main>` elements), and `scope` on the three tables read as reference — head to head, the all-time table, and the Gazette's four. Still open below. |

### What is left of the accessibility pass

Ten components still have `<th>` with no `scope`:
`stats/ValuePanel`, `stats/PacePanel`, `stats/NominationsPanel`,
`stats/TeamSpendPanel`, `history/DraftDnaPanel`, `history/members/[id]`,
`history/players/[playerId]`, `MarketPanel`, `SidePanel`, `LeagueBoard`.

They were left deliberately rather than missed. The live draft panels
(`SidePanel`, `LeagueBoard`, `MarketPanel`) are a different job from a reference
table — they update several times a second and are watched rather than read — so
they want thinking about as a group, not a blanket `scope="col"`. The `/stats`
and member panels are straightforward and just were not in this pass.

Also never done, and worth a session of its own rather than being smuggled into
another step:

- **Nothing has been run through an actual audit tool**, on any page. Everything
  above was found by reading. axe or Lighthouse will find things reading does not.
- **Focus visibility has never been checked** against the Broadsheet palette in
  either theme. The app relies on the browser default outline throughout.
- **Colour contrast has never been measured**, and `managers.color` is ten hues
  constrained four ways already (`src/lib/colors.ts`) — that is the one place a
  contrast fix could collide with an existing constraint rather than just being
  applied.
- **The `title` attribute is doing real work in several places** (the head-to-head
  cells, the Draft DNA bar) and is not available to keyboard or touch users at
  all. That is a pattern to replace, not a single fix.

**Removed from this table:** the draft recap page. `/stats` (§7) plus the `/board`
year picker (§2) are that feature — every past season is browsable and scored,
and `lots` / `picks` / `trades` are all read after the draft now.

---

## 12. What the front page leads with during the playoffs

**Raised 2026-09-07, deliberately parked.** Not for this season unless it grates
in December.

From the first completed week until a champion is crowned, `/` leads with the
season table (`PROGRESS_LOG.md`, "The front page stops leading with last year's
champion in November"). That is right for weeks one to fourteen and goes quiet
for three:

**`seasonSoFar()` counts regular-season games only, so during weeks 15–17 the
lead freezes at "Through week 14."** That is correct rather than broken. All-play,
versus-median, strength of schedule and efficiency are whole-field measures, and
a bracket week has four to six teams in it — an "all-play record against the
field" computed from a semi-final is not the same unit as one computed from a
full week, which is the rule `allPlay()` has enforced since it was written.

So for three weeks the largest thing on the page is a table that has stopped
moving, while the actual news is the bracket.

**What it is not:** an argument for putting playoff games into those columns.
That would silently change what every one of them means, and the resulting
numbers would be wrong in a way nobody could see.

Shape of the options, cheapest first:

| Option | Note |
|---|---|
| A line under the heading | "Playoffs under way — the bracket is in the Gazette." Honest, one line, keeps the table as the record of the regular season it is. |
| A bracket lead | Replace the table with the bracket for weeks 15–17. The data is there (`season_matchups.playoff_round`, `playoff_placement`, and `winners_bracket.json` is committed). A third lead state to build and maintain. |
| Leave it | The Gazette teaser sits directly below and covers the bracket weekly. The table simply says what it means: the regular season, finished. |

⚠️ Whatever is chosen, the swap back is already automatic and must stay that way:
the monument returns the moment `champion_manager_id` is set by the import that
reads the completed bracket. Nothing here should introduce a fourth state that
has to be turned off by hand in January.

---

## 13. Folding the record-by-week history into the playoff odds

The odds are a model of the current season; `/history/by-week` is what past
teams at the same record actually did. They are shown side by side and **not**
blended, on evidence: in October 2026, over 2020–2025, the model scored a Brier
of 0.159 and the history alone (leave-one-season-out) 0.192. Six seasons is too
thin — four 0-4 teams would overrule the model for everybody.

The model *is* too generous to the very worst starts (it gave the four 0-4 teams
10–29%; none made it), which is where a blend would help first.

**Trigger:** run `npm run odds:backtest` each offseason. When the history line
beats the model, or once there are 8–10 weekly seasons, try a blend — e.g. use
the history cell as the prior instead of `PRIOR_WEEKS` of league average — and
keep it only if the backtest says so. Do not tune `PRIOR_WEEKS` by eye.

---

## 14. Analytics ideas not chosen for Phase 3

A review on 2026-11-10 produced eighteen analytics ideas. Six were chosen, the league added
two of its own (Ask the Oracle and charts), and those eight are scheduled in
`docs/ANALYTICS_ROADMAP.md` (steps 38–61). These twelve were not. All are computable from
tables that already exist unless noted, and **Ask the Oracle answers most of them ad hoc** —
which is a fair test of whether any deserves a page: build one when people keep asking.

- **Schedule swap.** Each manager's record had they played every other manager's schedule.
  The luck column says *that* someone was lucky; this says by how much and against whom.
- **Games lost on the bench.** Losses the optimal lineup would have won, from
  `season_lineups.optimal_points` joined to the result. The Gazette has a weekly `startsit`
  stat and nothing keeps the running total.
- **Auction price history as a prep sheet.** What the 1st, 5th, 12th, 24th priciest player at
  each position cost each year. Within position only. The page people would open the week of
  the 2027 draft — worth reconsidering in July.
- **Hit rate by price tier.** How often a $1, $2–9, $10–29, $30–59, $60+ buy finished at or
  above its price rank. `valueVsResults()` already produces the delta.
- **Matchup preview.** Win probability for this week's games from the playoff-odds ratings and
  `season_schedule`. Stored data only.
- **Rivalry pages.** One page per pairing: game log, streak, average margin, playoff meetings.
  The head-to-head grid links to members and not to the pair.
- **Era-adjusted seasons.** Points-for against that season's league average, so 2012 and 2025
  can share a leaderboard.
- **Close-game record.** Record in games decided by under ten points.
- **Odds by week.** Re-run the playoff odds for each completed week and draw the lines, to
  show whose season turned and when. Would use the chart kit from step 45.
- **Scoring distribution.** Each manager's weekly scores as a strip or box plot. Would use the
  chart kit from step 45.
- **What wins this league.** Draft DNA traits against finish, across about sixty
  team-seasons. Must print its sample size and say that sixty is small.
- **In-season trade ledger.** Each trade with points scored by each side afterwards. Needs
  the transactions pull from step 58, so it is cheap once that lands.

---

## 15. Player stats — what Phase 4 left out

`player_week_stats` (steps 63–66, `docs/PLAYER_STATS_ROADMAP.md`) holds the NFL stat line of
every **rostered** player-week from 2020. These were ruled out of that work on purpose:

- **Stat lines in the Gazette.** The grounding check compares every digit in the prose
  against the fact pack, so adding yards and touchdowns to the pack is a pack change, a
  `PROMPT_VERSION` bump and a re-audit of the committed archive. Its own step, not a rider.
- **NFL players nobody rostered.** A second, ~65 MB import answering a different question
  ("the best waiver pick nobody made"). `trimStats()` drops them before anything is committed.
- **Pre-2020 stats.** Sleeper has no league data before 2020 and the endpoint is NFL-wide, so
  this would be a separate source with its own id-matching problem.
- **Projections** (`/projections/nfl/...`). A different feature.
- **Kicking stats.** The league has never had a K slot. If one is ever added, put the kicking
  keys back on the whitelist (`fgm`, `fga`, `xpm`, `xpa`, `fgm_50p`), re-run
  `db:migrate-player-stats` (it adds missing columns) and `history:pull -- --force`.
