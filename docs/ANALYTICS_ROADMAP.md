# Analytics roadmap — Phase 3

Eight features chosen by the league on 2026-11-10, broken into build steps **38–61**.
The checklist lives in `PROJECT_PLAN.md` §13. Ideas that were considered and not chosen are
in `BACKLOG.md` §14.

| | Feature | Steps | Needs new data? |
|---|---|---|---|
| A | **Ask the Oracle** — a question bar over the database | 38–44 | no |
| B | Chart kit and league charts | 45–47 | no |
| C | Playoff odds, extended | 48–49 | no |
| D | Positional scorecard | 50–51 | no |
| E | How the roster was built | 52–53 | no |
| F | Deeper record book | 54–55 | no |
| G | Rating over time | 56–57 | no |
| H | FAAB and waivers | 58–61 | yes — Sleeper transactions |

Build A first. B before E, G (they draw with the chart kit). H last. Otherwise any order.

---

## How to work a step

You are implementing **one step per sitting**. Each step below is written to be done without
reading the others.

1. Read `AGENTS.md` (the non-negotiables) and the one step you are doing. You do **not** need
   to read `docs/archive/`.
2. Read the files the step names before changing them. Check every function name and column
   name against the code — this document was written from a survey and the code wins.
3. Before writing any route, page or component, read the relevant guide in
   `node_modules/next/dist/docs/`. This Next.js version differs from what you remember.
4. Work on local Postgres only:
   `npm run db:local:up` → `npm run db:local:setup` → `npm run dev:local`.
   Run anything else with `npm run local -- <command>`. **Never** `npm run dev`.
5. A step is done when its **Done when** commands pass. Then: append an entry to
   `docs/PROGRESS_LOG.md` (template at the top of that file), tick the box in
   `PROJECT_PLAN.md` §13, and commit code and docs together.
6. If a **Stop and report if** condition is met, stop. Do not design around it.

### Rules that apply to every step

- Derivations are **pure functions in `src/lib/`** with unit tests beside them
  (`name.test.ts`). Pages and components stay thin and read through
  `src/server/history-service.ts`.
- **Null is unknown, never zero.** Unscored players, missing `sleeper_id`, seasons with no
  weekly data: say "unknown", do not print 0.
- **Compare value within a position, never across.** Add a unit test for it at every new site.
- Group on a player's **position**, never the lineup **slot**.
- Money attributes to the **drafter** via `draftersByPick()` in `src/lib/stats.ts`.
- Every panel states its coverage with `EraBadge` (`src/components/history/EraBadge.tsx`).
  Weekly data starts 2020, standings 2011, champions 2006.
- Week-scoped work filters to `week <= W` first. `season_schedule` is never a result.
- `season_standings.place` is the **regular season**, not the bracket.
- Nothing new on `/api/state` or in `src/lib/version.ts`. No `fetch(` in
  `src/server/draft-service.ts`.
- **No backticks inside SQL template literals.**
- Structural database changes go in a hand-written, idempotent `scripts/migrate-*.ts` with a
  `-- --test` flag, modelled on `scripts/migrate-queue.ts`. Never `drizzle-kit push`.
- Every new metric gets an entry in `src/lib/glossary.ts`.

---

# A. Ask the Oracle

A signed-in league member types a question — "how many times has Josh Allen scored over 20?"
— and gets an answer worked out from the league database, with the SQL and the rows shown
underneath so anyone can check it.

## Decisions already made — do not reopen them

- **One tool.** The model is given a single tool, `query`, that takes one SQL string. The
  server runs it and returns rows. The model answers from the rows. At most
  `MAX_STEPS = 5` tool calls per question.
- **The safety boundary is the database, not the prompt.** Three layers, all required:
  1. A Postgres role `oracle_reader` (`NOLOGIN`) that can read a schema called `oracle` and
     nothing else. `oracle` contains only views.
  2. Every query runs in one Neon HTTP batch with `readOnly: true`:
     ```ts
     await sql.transaction(
       [
         sql.query('SET LOCAL ROLE oracle_reader'),
         sql.query('SET LOCAL statement_timeout = 3000'),
         sql.query('SET LOCAL search_path = oracle'),
         sql.query(wrapped),
       ],
       { readOnly: true, fullResults: true },
     )
     ```
     No second connection string. It behaves the same through the local proxy and on Neon.
  3. A pure text guard that rejects anything that is not a single SELECT.
- **Never exposed, by any view:** `player_queue` (private by non-negotiable),
  `managers.pin_hash`, `week_issues`, `draft`, `lots`, `budget_adjustments`, `oracle_log`.
- **The model call** is a plain `fetch` to `https://api.anthropic.com/v1/messages`, the same
  way `scripts/history/gazette.ts` calls it (read `callModel` there for headers). No SDK. Not
  streamed in this version.
- **Signed-in members only**, with a daily cap, because every question costs money.
- **It lives on its own route.** Never on `/api/state`, never in the draft room, never read by
  the Gazette.

## Step 38 — the database boundary

**Goal:** the `oracle` schema, the `oracle_reader` role, and the `oracle_log` table exist, and
a query run as that role provably cannot see anything else.

**Create** `scripts/migrate-oracle.ts`, copying the shape of `scripts/migrate-queue.ts`
(same `--test` flag, same `step()` helper, same closing summary). Every statement idempotent.

In order:

1. Role, without failing if it exists:
   `DO $$ BEGIN CREATE ROLE oracle_reader NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$`
2. `GRANT oracle_reader TO CURRENT_USER` (needed for `SET LOCAL ROLE`).
3. `CREATE SCHEMA IF NOT EXISTS oracle`.
4. One `CREATE OR REPLACE VIEW oracle.<name> AS SELECT …` per row of this table. List columns
   explicitly — never `SELECT *` — and check each against `src/db/schema.ts`.

   | View | From | Columns | Notes for the `COMMENT` |
   |---|---|---|---|
   | `managers` | `managers` | `id AS manager_id`, `display_name AS name` | The ten league members. Nothing else from this table. |
   | `seasons` | `seasons` | season, data_tier, regular_season_weeks, playoff_week_start, playoff_teams, is_final, champion_manager_id, runner_up_manager_id, third_manager_id, champion_prize, runner_up_prize, third_prize, buy_in, side_bet, draft_city, draft_state | Null prize or side_bet is unknown, not zero. |
   | `standings` | `season_standings` | season, manager_id, `place AS regular_season_place`, wins, losses, ties, points_for, points_against, made_playoffs, playoff_wins, playoff_losses | 2011 on. `regular_season_place` is NOT the playoff finish; the champion is in `seasons`. |
   | `games` | `season_matchups` | season, week, manager_id, opponent_manager_id, points, opponent_points, result, is_playoff, playoff_round, playoff_placement | 2020 on. **Two rows per game**, one from each side. |
   | `lineups` | `season_lineups` | season, week, manager_id, actual_points, optimal_points | 2020 on. |
   | `player_weeks` | `player_weeks` | season, week, manager_id, player_id, player_name, position, nfl_team, is_starter, slot, points | 2020 on. **A row exists only for a week the player was on a roster in this league.** `player_id` is the Sleeper id. |
   | `player_seasons` | `player_seasons` | season, player_id, player_name, position, nfl_team, weeks_played, total_points, avg_points | Season totals. |
   | `auction_picks` | `picks` | season, pick_no, player_name, `player_team AS nfl_team`, `player_position AS position`, `player_sleeper_id AS player_id`, price, `manager_id AS owner_manager_id`, nominator_id | 2021 on. `owner_manager_id` is the owner after draft-night trades; it differs from the buyer only for traded players. `player_id` may be null (unknown). |
   | `draft_trades` | `trades` | season, manager_a_id, manager_b_id, picks_a_to_b, picks_b_to_a, cash_a_to_b, created_at | Draft-night trades only. |
   | `legacy_champions` | `legacy_champions` | season, champion_name, money_won | 2006–2010: a name and nothing else. |

5. `COMMENT ON VIEW oracle.<name> IS '…'` for each, using the notes column.
6. `GRANT USAGE ON SCHEMA oracle TO oracle_reader` and
   `GRANT SELECT ON ALL TABLES IN SCHEMA oracle TO oracle_reader`.
7. `CREATE TABLE IF NOT EXISTS oracle_log` in `public`: `id serial primary key`,
   `manager_id integer not null references managers(id)`, `question text not null`,
   `answer text`, `steps jsonb not null default '[]'`, `ok boolean not null`,
   `error text`, `ms integer`, `input_tokens integer`, `output_tokens integer`,
   `created_at timestamptz not null default now()`. Index on `(manager_id, created_at)`.
   Add the same table to `src/db/schema.ts` so the local bootstrap builds it.

**Also edit** `package.json`: add `"db:migrate-oracle"` next to `db:migrate-queue`, and add the
`--test` invocation to the `db:test-migrate` chain.

**Note:** `npm run db:local:setup` drops and recreates `public`, which cascades away every
`oracle` view. After any local setup, re-run
`npm run local -- npm run db:migrate-oracle`. Add that line to the local-development block of
`AGENTS.md`.

**Done when** (all against local):
- `npm run local -- npm run db:migrate-oracle` succeeds twice in a row.
- A throwaway script (do not commit it) running the batch above with
  `SELECT count(*) FROM managers` returns 10; with `SELECT * FROM public.player_queue` fails
  with permission denied; with `SELECT pin_hash FROM public.managers` fails; with
  `CREATE TABLE oracle.x (a int)` fails.

**Stop and report if** `SET LOCAL ROLE` inside `sql.transaction` does not take effect through
the local proxy (the forbidden reads succeed), or the role cannot be created.

## Step 39 — the guard and the runner

**Goal:** one function that takes untrusted SQL and either returns rows or a clear refusal.

**Create** `src/lib/oracle-sql.ts` — pure, no imports from `src/server`:
- `export const ROW_LIMIT = 200`
- `export function guardSql(input: string): { ok: true; sql: string } | { ok: false; reason: string }`
  - Trim; strip **one** trailing semicolon.
  - Reject if empty, longer than 4,000 characters, or containing any remaining `;`.
  - Reject if it contains `--` or `/*`.
  - Must start (case-insensitive) with `select` or `with`.
  - Reject on any of these as whole words, case-insensitive: `insert`, `update`, `delete`,
    `merge`, `truncate`, `drop`, `alter`, `create`, `grant`, `revoke`, `copy`, `call`.
  - Reject if it contains `pg_`, `information_schema`, `set_config` or `public.`.
  - On success return
    `SELECT * FROM (<input>) AS oracle_q LIMIT 201` (201 so truncation is detectable).
  - A semicolon inside a string literal is rejected too. That is accepted: the model can
    rephrase, and a stricter parser is not worth it.

**Create** `src/lib/oracle-sql.test.ts`: one test per rejection rule, plus: a plain SELECT
passes; a `WITH … SELECT` passes; `injury_updated_at` and `created_at` as column names are
**not** rejected by the whole-word rules; mixed case `SeLeCt` passes.

**Create** `src/server/oracle-service.ts`:
- `export async function runOracleQuery(input: string): Promise<{ ok: true; columns: string[]; rows: unknown[][]; truncated: boolean; ms: number } | { ok: false; reason: string }>`
- Calls `guardSql`, then the batch from "Decisions" using `getSql()` from `src/server/sql.ts`.
- Takes the last result of the batch; if 201 rows came back, drop one and set `truncated`.
- Catches database errors and returns `{ ok: false, reason: <the Postgres message> }` — the
  model needs the message to fix its own SQL. Never throw.

**Create** `src/server/oracle-service.itest.ts`, using the `ENABLED` / `describe.skip` guard
copied from `src/server/queue-service.itest.ts`. Tests:
- reads `managers` and gets `manager_id`, `name` and no other column;
- `SELECT * FROM player_queue` → refused;
- a query naming `pin_hash` → refused;
- a data-modifying CTE (`WITH x AS (DELETE FROM games RETURNING 1) SELECT * FROM x`) → refused
  by the guard, **and** when the wrapped text is sent straight to the batch (bypassing the
  guard) it is still refused by the database;
- `SELECT count(*) FROM generate_series(1, 100000000000)` → refused as a timeout, in under
  ten seconds;
- a 500-row `generate_series` → 200 rows, `truncated: true`.

**Done when:** `npm test` and `npm run local -- npm run test:int` pass
(run `npm run db:local:setup-test` then the oracle migration with `--test` first).

## Step 40 — the schema notes

**Goal:** the text that tells the model what it can query, kept honest by a test.

**Create** `src/lib/oracle-schema.ts`:
- `export const ORACLE_VIEWS: Array<{ name: string; columns: string[]; note: string }>` — the
  ten views from step 38, same names and columns.
- `export function oracleSchemaText(): string` — renders them as plain text, one view per
  block.
- `export const ORACLE_RULES: string` — the rules below, as prose. **No backticks in this
  file** except the ones that delimit the template itself.

The rules the text must contain:
1. Only these views exist. Query them unqualified.
2. Player weekly scores exist only for weeks the player was on a roster in this league, from
   2020. Any answer about a player's scoring must say "while rostered in this league, since
   2020". It is not the player's NFL career.
3. `games` has two rows per game. Count a game once: filter to one side, or divide.
4. `regular_season_place` is the regular season. Champions are in `seasons`.
5. Weekly data covers 2020 on, standings 2011 on, champions 2006 on. State the years an
   answer covers.
6. Null means unknown. Never report it as zero.
7. `owner_manager_id` on a pick is the owner after draft-night trades.
8. Match player and manager names with `ILIKE`; if a name matches more than one player, say
   so and list them rather than adding them together.
9. If the rows do not answer the question, say that plainly. Never use a figure that did not
   come back from a query. No NFL knowledge from memory.
10. Answer in one to three sentences, lead with the number, plain text, no markdown tables.

**Create** `src/lib/oracle-schema.test.ts`: read `scripts/migrate-oracle.ts` as text, extract
every `oracle.<name>` after `CREATE OR REPLACE VIEW`, and assert the set equals
`ORACLE_VIEWS` names. Assert none of `player_queue`, `pin_hash`, `week_issues`, `lots`
appears in `oracleSchemaText()`.

**Done when:** `npm test` passes.

## Step 41 — the tool loop

**Goal:** `askOracle(question)` returns an answer and the steps that produced it.

**Edit** `src/server/oracle-service.ts`:
- `export const ORACLE_MODEL = 'claude-sonnet-5-5'`, `export const MAX_STEPS = 5`.
- `export async function askOracle(question: string): Promise<OracleResult>` where
  ```ts
  interface OracleStep { sql: string; ok: boolean; columns: string[]; rows: unknown[][]; truncated: boolean; error: string | null; ms: number }
  interface OracleResult { ok: boolean; answer: string | null; steps: OracleStep[]; error: string | null; inputTokens: number; outputTokens: number }
  ```
- Request body: `model`, `max_tokens: 2000`, `system` = `ORACLE_RULES` + `oracleSchemaText()`,
  `tools: [{ name: 'query', description: 'Run one read-only SQL SELECT against the league database and get the rows back.', input_schema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] } }]`,
  `messages`.
- Loop: send; if `stop_reason === 'tool_use'`, for each `tool_use` block run
  `runOracleQuery(block.input.sql)`, record an `OracleStep`, append the assistant message
  unchanged, then a user message of `tool_result` blocks
  (`{ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(...) , is_error }`).
  Give the model at most the first 50 rows; tell it when there were more.
- Stop when the model answers with text, or after `MAX_STEPS` tool rounds (then return
  `ok: false`, `error: 'The Oracle could not work that out in five queries.'`).
- Missing `ANTHROPIC_API_KEY` → `ok: false` with a clear error, no throw. Non-200 from the
  API → same. `stop_reason === 'refusal'` → same.
- Sum `usage.input_tokens` and `usage.output_tokens` across calls.

If unsure of the Messages API tool-use shape, check the current Anthropic docs before
guessing; the shape above is the stable one.

**Create** `src/server/oracle-service.test.ts` with `fetch` mocked (`vi.stubGlobal`) and
`runOracleQuery` mocked: answers with no tool call; one tool round then an answer (assert the
`tool_result` message is well-formed and carries the `tool_use_id`); a refused query is passed
back as `is_error` and the loop continues; the step cap; missing key.

**Done when:** `npm test` passes, and by hand with a real key against local data:
`npm run local -- npx tsx -e "import('./src/server/oracle-service').then(m => m.askOracle('Who has the most regular-season wins since 2020?')).then(r => console.log(JSON.stringify(r, null, 2)))"`
returns an answer you have checked against `/history`.

## Step 42 — the route

**Goal:** `POST /api/ask`.

**Create** `src/app/api/ask/route.ts`, modelled on `src/app/api/queue/route.ts`:
- `export const dynamic = 'force-dynamic'`; `export const maxDuration = 60`; every response
  carries `Cache-Control: no-store, private`.
- Body: zod `{ question: z.string().trim().min(3).max(500) }`. Bad body → 400.
- `currentManagerId()` from `src/server/session.ts`; null → 401
  `{ ok: false, reason: 'Sign in to ask the Oracle' }`. There is no manager id in the body.
- Cap: `DAILY_LIMIT = 30`. Count `oracle_log` rows for this manager in the last 24 hours;
  at the limit → 429 with a reason that says when to come back.
- Call `askOracle`, time it, insert one `oracle_log` row whether it succeeded or not, and
  return `{ ok, answer, steps, error, remaining }`.
- Put the cap count and the insert in `src/server/oracle-service.ts`
  (`questionsToday`, `logQuestion`), each a single SQL statement.

**Create** `src/server/oracle-route.itest.ts` (or extend the existing itest): the cap counts
only the caller's rows; a logged question is retrievable; `oracle_log` is **not** readable
through `runOracleQuery`.

**Done when:** tests pass, and with `npm run dev:local`: a signed-out `curl -X POST` gets 401;
signed in (through `/join`) the page-less route answers a question.

## Step 43 — the page

**Goal:** `/history/oracle`, linked from the nav.

**Create** `src/components/OracleBar.tsx` (client component):
- A labelled text input and an Ask button; Enter submits; disabled while working.
- Working state: the question echoed back with "The Oracle is consulting the record…".
- Answer in the reading font used by the history pages. Under it a `<details>`
  "How this was worked out" listing each step: the SQL in a `<pre>`, then the rows as a small
  table (first 20), or the error. Mark a truncated result as such.
- Errors (401, 429, failure) shown in place, in words, never a raw status code.
- Keep the last five question-and-answer pairs on screen for the session, newest first. Do
  **not** send earlier turns to the server in this version — each question stands alone.
- Six example questions as buttons that fill the input, for instance: "How many times has
  Josh Allen scored over 20 points?", "Who has the most 150-point weeks?", "What is the most
  anyone has paid for a running back?", "Who has lost the most games by under five points?",
  "Which player has been started the most weeks?", "Who has the best playoff record?"

**Create** `src/app/history/oracle/page.tsx`: the same page shell as
`src/app/history/records/page.tsx` (`SiteNav`, `id="main"`), a one-paragraph explanation that
says plainly what the Oracle knows (this league's record: games from 2020, standings from
2011, auctions from 2021) and what it does not (the NFL at large), then `<OracleBar />`. If
the visitor is signed out, show a link to `/join` instead of the input.

**Edit** `src/components/SiteNav.tsx`: add
`{ href: '/history/oracle', label: 'Ask the Oracle', hint: 'Any question, from the record' }`
to the `league-history` items, above Glossary.

**Edit** `src/lib/glossary.ts`: an entry `id: 'oracle'`, group `league`, whose `note` states
the rostered-in-this-league scope and that the SQL is shown for checking.

**Done when:** `npm run lint` and `npm run build` pass; with `npm run dev:local`, signed in,
each of the six examples returns an answer and its SQL; signed out shows the join link; the
page is usable at phone width.

## Step 44 — ship

1. Add `ANTHROPIC_API_KEY` to the Vercel project (Production and Preview). The commissioner
   does this; ask.
2. `npm run db:migrate-oracle -- --test`, then `npm run test:int`.
3. With the commissioner's go-ahead, `npm run db:backup` then `npm run db:migrate-oracle`
   against the live database. Additive only: one schema of views, one role, one table.
4. Add an "Ask the Oracle" section to `docs/UAT.md`: signed-out is refused; a known answer is
   right; the SQL is shown; a question about the queue or PINs gets nothing; question 31 in
   a day is refused.
5. Ask twenty real questions on the deployed site. For every wrong or evasive answer, read
   `oracle_log.steps`, and fix it by sharpening `ORACLE_RULES` or a view `note` — not by
   special-casing the question. Record the misses in the progress-log entry.
6. Add to `AGENTS.md` commands: `npm run db:migrate-oracle`.

---

# B. Charts

## Step 45 — the chart kit

**Goal:** four reusable chart components, so later steps draw rather than invent.

**Read first:** `src/components/stats/CurvePanel.tsx` and
`src/components/history/PlayerTimeline.tsx` (how this codebase draws SVG), and
`src/lib/colors.ts` (manager colours). **No chart library.**

**Create** in `src/components/charts/`:
- `LineChart.tsx` — `series: Array<{ id, label, color, points: Array<{ x: number; y: number | null }> }>`,
  `xLabel(x)`, `yLabel(y)`. A null `y` breaks the line; it is never drawn as zero. Direct
  labels at the right-hand end of each line, nudged apart so they do not overlap. Hovering or
  focusing a line dims the others.
- `BarChart.tsx` — horizontal bars, one value per row, value printed at the bar's end.
- `StackedBar.tsx` — one row per item, segments that sum to the row; each segment labelled
  when wide enough, and a legend otherwise.
- `Donut.tsx` — for one part-to-whole with **at most five slices**; label each slice with its
  name and share.
- `scale.ts` — `linearScale`, `niceTicks`, pure and unit-tested.

Every chart: an SVG with `role="img"` and an `aria-label`, plus the same data as a visually
hidden `<table>`. Works in the Paper and Night themes (use the existing CSS variables, no
hardcoded greys). Scales to its container width.

**Done when:** `scale.test.ts` passes; a temporary page renders all four with fixture data in
both themes at desktop and phone width (delete the temporary page before committing).

## Step 46 — the league charts page

**Goal:** `/history/charts`, starting with the chart from the old spreadsheet.

**Create** `src/lib/chart-series.ts` (pure, tested), fed by `HistoryInput` from
`src/lib/history.ts`:
- `cumulativeWins(input)` — per manager, running total of regular-season wins by season, from
  `standings`, 2011 on. A manager with no row that season carries their total forward flat
  from their first season; before their first season the value is null.
- `cumulativePoints(input)` — same for points for.
- `finishBySeason(input)` — regular-season place per manager per season (a bump chart: y axis
  inverted, 1 at the top).
- `titlesAndMoney(input)` — reuse `leagueSummary()`; do not recompute.

**Create** `src/app/history/charts/page.tsx`: four sections, each a chart, a one-sentence
caption saying what to look for, and an `EraBadge`. Add to `SiteNav` as
`{ href: '/history/charts', label: 'Charts', hint: 'The league, drawn' }`.

**Tests:** cumulative totals for a three-season fixture; the final cumulative win value for
every manager equals `leagueSummary()`'s win total for 2011 on.

## Step 47 — charts on existing pages

- Member page (`src/app/history/members/[id]/page.tsx`): a `Donut` of career auction spend by
  position, from `draftDna().career.positionSpend` (`src/lib/draft-dna.ts`). Five slices: QB,
  RB, WR, TE, OTHER.
- Past Auctions (`src/app/history/drafts/page.tsx`): a `StackedBar` with one row per season,
  segments = each position's share of all dollars spent that year. Attribute through
  `teamSpend()` in `src/lib/stats.ts`; do not write a second spend calculation.

**Stop and report if** either number disagrees with what the page already prints in text.

---

# C. Playoff odds, extended

**Read first:** all of `src/lib/playoff-odds.ts`, its test file, `src/lib/playoff-backtest.ts`,
and `src/components/season/PlayoffOddsPanel.tsx`.

## Step 48 — seed distribution and leverage

**Edit** `playoffOdds()` to also return, per manager, from the **same** simulation loop:
- `seedPct: number[]` — share of simulations finishing in each seed, index 0 = first.
- `leverage: { ifWin: number; ifLose: number } | null` — playoff % among simulations where
  they won their next scheduled game, and among those where they lost it. Null when no game
  remains.

**Hard constraint:** `playoffPct`, `byePct` and `projectedWins` must be **bit-for-bit
unchanged** for the same input. Do not add, remove or reorder any random draw. Add a test
that snapshots the existing outputs for a fixture before your change and asserts them after.

**Tests:** each manager's `seedPct` sums to 1; the first `playoffTeams` entries sum to
`playoffPct`; `ifWin >= ifLose` for a fixture where that must hold.

**UI:** a "Win / Lose" column in `PlayoffOddsPanel` printed through `formatOdds`, and a thin
ten-cell seed strip per row. Glossary entries for both.

**Done when:** tests pass and `npm run local -- npm run odds:backtest` prints the same Brier
score as before the change.

## Step 49 — title odds

**Read first:** `data/sleeper/2025/winners_bracket.json` and how `byesFor()` is used, to
mirror the real bracket (six teams, two byes; confirm whether Sleeper re-seeds).

**Edit** `playoffOdds()`: after seeding each simulation, play the bracket with the same
per-team rating model and return `titlePct` per manager. Bracket draws must come **after**
all regular-season draws, from a separately seeded generator, so step 48's constraint still
holds.

**Tests:** `titlePct` sums to 1 across the league; a team with `playoffPct` 0 has `titlePct`
0; unchanged-output snapshot still passes.

**UI:** a "Title" column, through `formatOdds`.

---

# D. Positional scorecard

## Step 50 — the derivation

**Create** `src/lib/positional.ts`:
`positionalScorecard(rows, season, weekKeys)` → per manager, per position (QB, RB, WR, TE,
K, DEF): started points, league mean of started points at that position, and the difference.
- Input rows are `player_weeks` with `isStarter` true. Group on `position`, never `slot`.
- Regular season only: pass the week keys from `regularSeasonWeekKeys()` in
  `src/lib/history.ts`.
- A row with null position goes to an "unknown" bucket that is reported, not dropped.

**Tests:** a WR started in FLEX counts as WR; the differences at each position sum to zero
across the league; each manager's positions sum to their started total.

Add a loader in `src/server/history-service.ts`.

## Step 51 — the pages

- Member page: a table, one row per season (2020 on), one column per position, showing the
  difference with sign.
- A ten-team grid for one season beside `SeasonSoFarPanel` on the front page
  (`src/components/season/`), for the current season to date. Cell shade by size of the
  difference; the number is always printed as text too.
- Glossary entry. `EraBadge`.

---

# E. How the roster was built

**Needs step 45.**

## Step 52 — the derivation

**Create** `src/lib/roster-origin.ts`: for one season, each manager's **started** points split
into:
- `drafted` — the manager bought the player at that season's auction;
- `tradedAtDraft` — acquired in a draft-night trade;
- `addedLater` — on no auction pick of theirs;
- `unknown` — the player's pick has a null `player_sleeper_id`, so it cannot be matched.

Match `player_weeks.player_id` to `picks.player_sleeper_id` for the same season. Resolve the
buyer with `draftersByPick()` from `src/lib/stats.ts`. Never guess a match by name.

**Tests:** the four parts sum to the manager's started total; a traded player's points land
in `tradedAtDraft` for the new owner; an unmatched pick produces `unknown`, not
`addedLater`.

Coverage is 2021 on (seasons with both an auction and weekly data).

## Step 53 — the page

A `StackedBar`, one row per manager, on each season's review card
(`src/components/history/SeasonReviewCard.tsx`) and a per-season row on the member page.
Glossary entry. When step 61 has landed, split `addedLater` into waiver and trade.

---

# F. Deeper record book

## Step 54 — top-ten lists

**Read first:** `records()` in `src/lib/history.ts` and
`src/app/history/records/page.tsx`.

Add `recordLists(input)` returning the top ten for each single-game and season record that
`records()` already has. Derive both from the same sorted rows so the existing holder is
always entry one — add a test asserting that for every key. Show each list in a `<details>`
under its record.

## Step 55 — the player record book

**Create** `src/lib/player-records.ts` from `player_weeks` (2020 on, rostered players only):
best single week by a starter; best week left on a bench; most bench points by one team in a
loss; best season total at each position; most weeks started for one manager. Every entry
names the manager who had the player.

**Tests:** per-position records never compare across positions; a bench record never returns
a starter.

Add a "Players" section to the records page with an `EraBadge` that says "rostered players,
2020 on".

---

# G. Rating over time

**Needs step 45.**

## Step 56 — the rating

**Create** `src/lib/rating.ts`: `ratingHistory(matchups, seasons)` → per manager, a rating
after every game, 2020 on.
- Everyone starts at 1500. `K = 20`.
- Expected score from the rating gap in the usual Elo form; multiply the update by a margin
  factor `ln(|margin| + 1)` scaled so an average margin gives 1.
- Between seasons, move every rating one third of the way back to 1500.
- Include regular-season games and playoff games that `isCountedPlayoff()` accepts. Process
  each game once (matchups are stored once per side).
- Deterministic: sort by season, week, then manager id.

**Tests:** ratings are zero-sum within a game; a win never lowers a rating; the regression
step; identical output on repeated runs.

## Step 57 — the page

`/history/ratings`: a `LineChart` of all ten managers, x = game week across seasons with
season boundaries marked, and a small table of each manager's peak and low with the week it
happened. A one-manager version on the member page. Nav entry, glossary entry (say plainly it
is a model, not a record).

---

# H. FAAB and waivers

The league runs a $100 FAAB budget. None of it is in the database today.

## Step 58 — pull transactions

**Read first:** `scripts/history/pull-sleeper.ts`.

Add `league/{leagueId}/transactions/{week}` for each week, written to
`data/sleeper/{season}/transactions-NN.json` and listed in that season's `MANIFEST.json`
like the matchup files.

**First:** check, for each season 2020–2026, whether Sleeper still returns transactions.
Record the answer in the progress log. The feature's coverage is whatever comes back.

**Stop and report if** nothing before 2026 is available — the commissioner decides whether
one season is worth the feature.

## Step 59 — the table and the importer

`scripts/migrate-transactions.ts` creates `season_transactions`: season, week,
`transaction_id` (unique with season), type (`waiver` / `free_agent` / `trade`), status,
`manager_id`, `counterparty_manager_id`, `player_id_added`, `player_id_dropped`, `faab_bid`,
`created_at`. One row per player movement, so a two-for-one trade is several rows sharing a
`transaction_id`. Add to `src/db/schema.ts`, to `db:test-migrate`, and import in
`scripts/import-sleeper-history.ts` (idempotent: delete the season's rows, insert, in one
statement). Keep **failed** waiver bids — who lost the bidding is half the story.

## Step 60 — the derivation

**Create** `src/lib/faab.ts`: per manager per season — FAAB spent and remaining; number of
claims; points scored **for that manager** by each claimed player after the claim week (from
`player_weeks`); the most expensive claims; the worst claims (dollars spent, points
returned); losing bids. A $0 claim has no points-per-dollar; report points only.

## Step 61 — the page

`/history/waivers` with a season picker; a "FAAB left" column beside `SeasonSoFarPanel` for
the current season; add an `oracle.transactions` view (step 38's migration and step 40's
notes, with the test that keeps them in step); split `addedLater` in step 53.
