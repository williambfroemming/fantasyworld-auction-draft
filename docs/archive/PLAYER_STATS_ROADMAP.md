# Player stats — Phase 4

Store each player's **weekly stat line** (yards, TDs, targets, receptions, kicks, sacks …), so the
league database can answer "how many yards did he have that week?" and the Oracle can too.

Written 2026-11-11. Steps **63–66**. Progress: see `docs/PROGRESS_LOG.md`. The checklist lives in `PROJECT_PLAN.md` §13 (section K).
Built to be handed to one agent in one worktree: **everything it needs is in this file.**

## Why this is needed

Today the database holds fantasy **points** per player per week (`player_weeks.points`) and the
season total (`player_seasons`). It holds no underlying stats. The league's old spreadsheet
tracked them. Size was never the obstacle — see "Size" below.

## The source: Sleeper, which the repo already uses

```
GET https://api.sleeper.app/v1/stats/nfl/regular/{season}/{week}
```

No key. Verified on 2026-11-11 for **2020, 2021, 2022, 2023, 2024 and 2025, week 1** — each
returned ~1,800–2,500 entries. The response is a single JSON object:

- Keys are **Sleeper player ids** — the same id `player_weeks.player_id` already holds, so the
  join needs **no name matching**. (Team defenses are keyed by team abbreviation such as `HOU`,
  and also as `TEAM_BUF`; **step 63 must check which form `player_weeks.player_id` uses for a DEF
  and pin it.**)
- Each value is a flat object of ~228 distinct stat keys, **only the ones that are non-zero**.
  A player with no rushing attempts has no `rush_att` key. Examples: `pass_att`, `pass_cmp`,
  `pass_yd`, `pass_td`, `pass_int`, `rush_att`, `rush_yd`, `rush_td`, `rec_tgt`, `rec`, `rec_yd`,
  `rec_td`, `fum_lost`, `fgm`, `xpm`, `sack`, `int`, `def_td`, `gp`.
- Also in there: `pts_ppr`, `pts_half_ppr`, `pts_std`, `pos_rank_*`. **Do not store these** — see
  Decisions.

Considered and rejected: **nflverse** (free weekly files, goes back further, but its ids are not
Sleeper's, which reintroduces the name-matching problem `sleeper_id` exists to avoid) and
**Kaggle** (cannot update itself — the user's original problem).

## Decisions already made — do not reopen them

- **Rostered players only.** Keep a `(season, week, player_id)` entry only if that player appears
  in that week's `matchups-NN.json` `players` list. The raw file is ~570 KB a week; committing
  every week of every season unfiltered is ~65 MB. Filtered it is a few hundred KB in total. It
  also matches `player_weeks`, which already means "on a roster in this league" — so say so in
  the Oracle note rather than letting someone read it as a full NFL stat table.
- **Whitelisted stat keys, not the whole object.** Typed `numeric` columns, not `jsonb`, because
  the Oracle writes SQL and `SUM(rec_yd)` beats `SUM((stats->>'rec_yd')::numeric)` for a model
  that has to get it right in five tool calls. The starting whitelist is below; step 63 confirms
  every name against a real file before step 64 freezes the columns.
- **Do not store Sleeper's `pts_*`.** The league's own scoring is in `player_weeks.points`. A
  second, different points figure beside it invites comparing the two and trusting the wrong one.
- **Keyed `(season, week, player_id)`, not by manager.** A stat line is a fact about the player,
  not the manager who held him. Join to `player_weeks` on those three columns to get the manager.
- **Null is unknown, zero is a real zero.** Sleeper omits a key when the value is 0. So:
  - an entry with `gp >= 1`: every absent whitelisted key is stored as **0**;
  - an entry with no `gp`, or `gp = 0` (inactive, bye): store **NULL** for every stat and
    `gp` NULL. They are "did not play", which is not "played and gained zero yards";
  - a rostered player with **no entry at all** gets **no row**.
  A unit test must pin all three. This is the central correctness point of the whole feature.
- **A third-party fetch stays off every request path.** Same rule as `AGENTS.md`: the pull is a
  script that writes files, the importer reads files, the app reads Postgres. No `fetch(` in
  `src/`.
- **Rewritten wholesale each run**, like the rest of the season. Stat corrections land through
  the week, and the Tuesday refresh already rewrites the season. Delete-and-insert one season in
  one statement. The Gazette snapshots its fact pack, so a later correction cannot contradict a
  published issue; this feature adds nothing to the pack (see Out of scope).
- **Coverage is 2020 on**, same as `player_weeks`. Every new panel uses `EraBadge`.

## How to work a step

Identical to `docs/archive/ANALYTICS_ROADMAP.md` "How to work a step" — read `AGENTS.md` first, check
names against the code (the code wins over this file), read the relevant guide in
`node_modules/next/dist/docs/` before writing any route or page, work on local Postgres only
(`npm run db:local:up` → `db:local:setup` → `npm run local -- <cmd>`; **never** `npm run dev`),
and finish each step with a `docs/PROGRESS_LOG.md` entry (with **Learned** and **Watch out
for**), the box ticked in `PROJECT_PLAN.md` §13, and code and docs in one commit.

Rules from the analytics roadmap that apply here: derivations are pure functions in `src/lib/`
with a test beside them; **null is unknown, never zero**; no backticks inside SQL template
literals; structural DB changes go in a hand-written idempotent `scripts/migrate-*.ts` with a
`-- --test` flag (model: `scripts/migrate-queue.ts`), never `drizzle-kit push`; every new metric
gets a `src/lib/glossary.ts` entry.

### Whitelist (confirmed in step 63, 2026-11-11)

| Group | Stored as | Sleeper key, where different |
|---|---|---|
| Presence | `gp` | |
| Passing | `pass_att`, `pass_cmp`, `pass_yd`, `pass_td`, `pass_int`, `pass_sack`, `pass_2pt` | |
| Rushing | `rush_att`, `rush_yd`, `rush_td`, `rush_2pt` | |
| Receiving | `rec_tgt`, `rec`, `rec_yd`, `rec_td`, `rec_2pt` | |
| Ball security | `fum`, `fum_lost` | |
| Defense / ST | `sack`, `def_int`, `fum_rec`, `def_td`, `def_st_td`, `safe`, `pts_allow`, `yds_allow`, `blk_kick` | `def_int` is Sleeper's `int` |

Changed from the starting list, and why:

- **Kicking dropped.** The league has never had a K slot (`roster_positions` 2020–2026) and no
  rostered entry in any week 2020–2026 carries `fgm`. Nobody can ask a kicking question of this
  league's rosters.
- **`def_st_td` added.** A defense's special-teams touchdown (kick or punt return) is a separate
  key from `def_td`; "how many touchdowns did his defense score" needs both.
- **`int` stored as `def_int`.** Postgres accepts a bare `int` column, but a model writing
  `SELECT int` next to `CAST(x AS int)` is one slip from a type name.
- **Each id zero-fills only its own group.** Defensive keys never occur on a numeric player id and
  offensive keys never occur on a team id (checked over every rostered entry 2020–2026). A played
  WR gets 0 in passing/rushing/receiving and **NULL** in the defense columns, and a defense the
  reverse; otherwise "fewest points allowed" returns a wide receiver with `pts_allow = 0`.

Do not add a key because it is there. Add it because someone would ask a question that needs it.

---

## Step 63 — pull the stats

**Read first:** `scripts/history/pull-sleeper.ts` (especially the header comment and the
`matchups-NN` loop near line 112), `scripts/import-sleeper-history.ts` `verifyManifest` (~line
105), and `data/sleeper/2025/matchups-01.json` (each entry has `players`, a list of Sleeper ids).

**Do:**
1. **First, before writing anything,** call the endpoint for every season 2020–2026 for weeks 1,
   9 and the final week, and record in the progress log: did each return data, how many entries,
   how many of that week's rostered ids are present. The feature's coverage is whatever comes
   back. Also pin how a DEF appears in `player_weeks.player_id` and which key form (`HOU` /
   `TEAM_HOU`) the stats file uses for it.
2. Confirm every whitelist key above exists in a real file and name the long-kick and any
   two-point keys properly. Fix the whitelist in this document if it was wrong.
3. Extend `pull-sleeper.ts` to fetch `stats/nfl/regular/{season}/{week}` for each week it already
   pulls matchups for, **filter to that week's rostered ids and the whitelisted keys**, and write
   `data/sleeper/{season}/stats-NN.json`. List each file in that season's `MANIFEST.json`
   (count and sha256) exactly like the matchup files.
4. Update the header comment of `pull-sleeper.ts`: it says it writes responses "verbatim", and
   these files are deliberately **not** — say why (size) and what was dropped.
5. `refresh-season.ts` already runs `pull-sleeper.ts --force` for the current season, and the
   weekly GitHub Action commits `data/`, so no change should be needed there. **Verify, do not
   assume**: read `.github/workflows/weekly-history.yml` and confirm the new files are inside
   the paths it commits.
6. Run `npm run history:pull -- --force` for all seasons. Commit the files.

**Done when:** `npm run history:pull` succeeds; every season's `MANIFEST.json` lists the stats
files; `git diff --stat data/` is under ~2 MB; the importer's manifest check still passes for
seasons that predate this (`npm run local -- npm run history:import-sleeper -- --season 2022`
does not complain).

**Stop and report if:** any season 2020–2025 returns an empty object for stats, or the rostered
ids largely fail to appear in the stats file (the ids are a different form than expected). The
commissioner decides whether a partial history is worth shipping.

## Step 64 — the table and the importer

**Read first:** `scripts/migrate-queue.ts` (the migration model), `scripts/migrate-history.ts`
(`player_weeks` DDL, ~line 115), `src/db/schema.ts` `playerWeeks` (~line 726), and
`scripts/import-sleeper-history.ts` around the `player_weeks` insert (~line 364–380).

**Create:**
- `scripts/migrate-player-stats.ts` — idempotent, `-- --test` flag, creates `player_week_stats`:
  `season`, `week`, `player_id` (primary key together), `gp`, then one `numeric(8,2)` column per
  whitelisted key (snake_case, same names as Sleeper), all nullable. Foreign key `season →
  seasons`. Index on `player_id` and on `season`. Add `db:migrate-player-stats` to `package.json`
  and the `-- --test` call to the `db:test-migrate` chain.
- The `playerWeekStats` table in `src/db/schema.ts` so `db:local:setup` builds it.
- A **pure function** `statRows(season, week, entries, rosteredIds)` in `src/lib/player-stats.ts`
  with `src/lib/player-stats.test.ts` pinning the three null/zero cases in "Decisions", plus: a
  rostered id missing from the stats file produces no row, and a non-whitelisted key is dropped.
- The import in `scripts/import-sleeper-history.ts`: delete the season's `player_week_stats`
  rows and insert the new ones **in one statement**, in the same style as the neighbouring
  inserts. Print a row count per season in the existing summary.

**Done when:**
```
npm run db:local:up && npm run db:local:setup
npm run local -- npm run db:migrate-player-stats
npm run local -- npm run db:migrate-player-stats     # second run is a no-op
npm run local -- npm run history:import-sleeper
npm test
npm run local -- npm run test:int
```
all pass, and this returns a believable number (a good week-1 QB has hundreds of yards):
```sql
SELECT pw.player_name, s.pass_yd, s.pass_td, pw.points
FROM player_week_stats s
JOIN player_weeks pw USING (season, week, player_id)
WHERE s.season = 2025 AND s.week = 1 AND pw.position = 'QB'
ORDER BY s.pass_yd DESC LIMIT 5;
```

**Stop and report if:** the join to `player_weeks` matches well under ~95% of `player_weeks`
rows for a season — list which ids fail before changing anything.

## Step 65 — the Oracle learns about stats

**Read first:** `AGENTS.md` (the Oracle non-negotiable), `scripts/migrate-oracle.ts`,
`src/lib/oracle-schema.ts`, and the test that keeps the two in step.

**Do:** add an `oracle.player_week_stats` view with explicit columns (never `SELECT *`) to
`scripts/migrate-oracle.ts`, a `COMMENT`, and a matching entry in `src/lib/oracle-schema.ts`.
The note must state, in plain words the model will act on:
- one row per **rostered** player per week, 2020 on — not NFL career totals;
- a column that is NULL means the player did not play; 0 is a real zero;
- it joins to `player_weeks` on `season, week, player_id`, and the manager comes from there;
- these are Sleeper's raw stats and **not** this league's points — use `player_weeks.points`
  for fantasy points.

Add glossary entries for any named derived stat you introduce (a plain "yards" does not need one).

Re-run `db:migrate-oracle` after `db:local:setup`. Never widen the role's grants.

**Done when:** `npm test` passes including the schema-notes test, and the Oracle's guard test
still shows `player_queue`, `pin_hash`, `week_issues`, `lots` and `oracle_log` unreachable. Ask
the Oracle locally (`npm run dev:local`, `/history/oracle`) three questions and paste the
answers in the progress log: *"Which running back had the most rushing yards in a single week?"*,
*"How many 300-yard passing games has each manager's QBs had?"*, *"Who had the most targets
without catching a touchdown in 2025?"*

**Stop and report if:** the Oracle returns a figure that disagrees with the same query run by
hand. That is a bug in the note, not the model.

## Step 66 — show the stat line

**Read first:** whichever page already shows a player's week — find it with
`grep -rn "player_weeks\|playerWeeks" src/ --include=*.ts --include=*.tsx`. If no page shows
per-player weekly detail, **stop and report**; do not invent a page.

**Create:** `formatStatLine(position, stats)` in `src/lib/player-stats.ts`, pure and tested:
`QB` → `23/31, 287 yds, 2 TD, 1 INT`; `RB` → `18 car, 94 yds, 1 TD · 3 rec, 21 yds`; `WR`/`TE` →
`7 rec / 10 tgt, 98 yds, 1 TD`; `K` → `3/4 FG, 2/2 XP`; `DEF` → `3 sacks, 1 INT, 17 allowed`.
Omit a zero group rather than print it (a WR with no carries has no "0 car"). **Return null when
the stats are NULL** — never `0/0, 0 yds` for a player who didn't play. Group on `position`,
never the lineup slot.

Show it where the weekly score is already shown, with `EraBadge`. Read through
`src/server/history-service.ts`; the component stays thin.

**Done when:** `npm test` and `npm run build` pass; the page renders a line for a 2025 week and
renders nothing (not zeros) for a player who was inactive.

## Out of scope — park these in `docs/BACKLOG.md`

- **Gazette integration.** The grounding check compares every digit in the prose against the
  fact pack. Adding stat lines to the pack is a prompt-version bump, a pack change and a
  re-audit of the archive. It deserves its own step, not a rider on this one.
- **NFL players nobody rostered.** Needs a second, much larger import and answers a different
  question ("who was the best waiver pick nobody made").
- **Pre-2020 stats.** Sleeper has no league data there, and the endpoint is NFL-wide, so this
  would be a separate source.
- **Projections** (`/projections/nfl/...`) — a different feature.
