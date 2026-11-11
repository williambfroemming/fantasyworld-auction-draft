# Progress Log

**Append-only.** Never edit a past entry — if something turns out wrong, write a new entry correcting it and note which entry it supersedes. The history of what we believed and when is part of the value.

One entry per completed build step from `PROJECT_PLAN.md` §13. The **Learned** and **Watch out for** lines are the point of this file: they're the things that cost an hour to find and five seconds to write down, and they're exactly what a fresh context window otherwise pays for twice. An entry with an empty **Learned** line is a smell, not a clean run.

### Template

```markdown
## Step N — <name>
**Date:** YYYY-MM-DD  **Status:** done
**Built:** files/modules created or changed
**Decisions:** anything chosen that wasn't already in PROJECT_PLAN.md (and update that file too)
**Learned:** the non-obvious thing. Be specific.
**Watch out for:** the trap the next person would otherwise fall into
**Next:** step N+1
```

### Where the earlier entries are

Steps 1–37 and everything else written before 2026-11-10 live in
`docs/archive/PROGRESS_LOG_2026.md` — about 3,900 lines. **You do not need to read
the archive to start a step.** The lessons that still bind are the non-negotiables in
`AGENTS.md`; search the archive when a source comment cites "PROGRESS_LOG step N" or
when you want the history behind one of those rules.

This file starts at **step 38** (`docs/ANALYTICS_ROADMAP.md`).

---

## Step 38 — the database boundary
**Date:** 2026-11-10  **Status:** done
**Built:** `scripts/migrate-oracle.ts` (role `oracle_reader` NOLOGIN, schema `oracle` with ten explicit-column views each with a `COMMENT`, grants, `oracle_log` + index); `oracle_log` added to `src/db/schema.ts` so the local bootstrap builds it; `db:migrate-oracle` script and the `--test` call added to the `db:test-migrate` chain in `package.json`. The AGENTS.md re-run line was already present from the docs commit.
**Decisions:** the migration also runs `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM oracle_reader` — a no-op today, but it erases any stray grant from an earlier experiment on the next run. `VIEWS` is deliberately **not exported**: the script runs `main()` on import, so importing it from the step 40 test would run the migration. That test should read the views from the database (`information_schema`), not from this file.
**Learned:** `SET LOCAL ROLE oracle_reader` as the first statement of a `sql.transaction([...], { readOnly: true })` batch DOES take effect through the local proxy (`current_user` reads `oracle_reader` inside it). This was untested going in. The role needs no grant on any base table: views run with their owner's privileges, which is how it can read `oracle.managers` while `public.managers.pin_hash` is refused. The refusal text depends on the database: local (`public` rebuilt by bootstrap, no PUBLIC grant) says `permission denied for schema public`; with `USAGE` on `public` granted to PUBLIC, as on Neon, it says `permission denied for table player_queue`. Step 39 must not match on either wording. Also: `CREATE TABLE oracle.x` inside the `readOnly` batch fails on "read-only transaction" *before* any permission check, so the roadmap's fourth check does not prove the role cannot write. I also ran it with `readOnly: false` and got `permission denied for schema oracle`, which does.
**Watch out for:** (1) `db:local:setup` drops `public` and with it every view, but the role and the empty `oracle` schema survive — re-run `db:migrate-oracle` every time. (2) Local data has no history imported, so most views count 0 rows; only `managers` (10) proves anything about content. (3) `numeric` columns (`points`, `price`-adjacent totals) come back as strings from Neon, so step 39's runner returns strings for every points column. (4) `npm run local --` is what keeps `dotenv -e .env.local` from pointing the script at Neon; the local DB is also named `neondb`, so the script's "in neondb" banner cannot tell you which one you hit. (5) The roadmap's other view columns all matched `schema.ts`; no name disagreed.
**Next:** step 39 — the SQL guard and the read-only runner

## Step 39 — the SQL guard and the read-only runner
**Date:** 2026-11-10  **Status:** done
**Built:** `src/lib/oracle-sql.ts` (`guardSql`, `ROW_LIMIT`, `MAX_SQL_LENGTH`) and `oracle-sql.test.ts` (28 tests); `src/server/oracle-service.ts` (`runOracleQuery`, `STATEMENT_TIMEOUT_MS`); `src/server/oracle-service.itest.ts` (10 tests). Unit suite 504 passing; the full `test:int` run, all eight suites, is 103 passing against a seeded local `neondb_test`.
**Decisions:** the batch passes `arrayMode: true` as well as `fullResults`, so `rows` are arrays and `columns` come from `fields` — a join selecting `a.x, b.x` keeps both columns instead of one silently overwriting the other. The itest sends the unguarded attack straight to the batch with its own `sql.transaction`, so the service exports nothing that skips the guard.
**Learned:** `\b` treats `_` as a word character, so the whole-word rules need no special-casing for `created_at`, `injury_updated_at` or `deleted_flag` — the test pins it. The guard is NOT what stops `SELECT * FROM "public"."player_queue"`: quoting the schema defeats the `public.` substring rule, the guard returns ok, and the database refuses it (`permission denied for schema public`). Verified. That is by design (layer 3 is the boundary), but it means the guard's rejection list is a courtesy and no test of it is evidence of safety. `statement_timeout` surfaces as a Postgres error whose text contains "timeout", so it flows through the same `{ ok: false, reason }` path as every other error with no special case; a runaway `generate_series` is cancelled at ~3s.
**Watch out for:** (1) `npm run test:int -- <file>` does NOT filter: the script ends in `npx vitest run --config …`, so extra args are not forwarded and the whole suite runs. (2) The other integration suites need the test DB seeded — after `db:local:setup-test` run `npm run local -- npm run db:test-seed` (and `db:migrate-oracle -- --test` for these tests) or 70-odd tests fail with `undefined.id`, which looks like a code bug. `db:test-seed` has to come before the oracle migration order matters not, but both are needed. (3) The 201st row is dropped and `truncated` set only when 201 come back, so exactly 200 rows is not truncated (tested). (4) Refusal wording differs local vs Neon; assert `ok === false`, never the text. (5) Points columns arrive as strings.
**Next:** step 40 — the schema notes the model reads, kept in step with the views by a test

## Step 40 — the schema notes
**Date:** 2026-11-10  **Status:** done
**Built:** `src/lib/oracle-schema.ts` (`ORACLE_VIEWS`, `ORACLE_RULES`, `oracleSchemaText()`), `oracle-schema.test.ts` (7 tests).
**Decisions:** the roadmap's ten rules are there verbatim in spirit, plus two I added: rule 2 (how queries are run — one SELECT, no semicolons or comments, 200 rows returned, first 50 seen) so the model stops writing things the guard will refuse, and rule 11 (compare within a position, never across), because AGENTS.md calls that the most-repeated mistake in the codebase and the Oracle is a new place to make it. The prompt never names a private table, even to say it is off limits.
**Learned:** the roadmap's test recipe (regex `CREATE OR REPLACE VIEW oracle.<name>`) cannot work against the step 38 script, which writes `oracle.${v.name}` from a template. The test instead parses each `name / from / select` entry of `VIEWS` in `scripts/migrate-oracle.ts` as text, which also lets it compare COLUMNS (resolving `x AS y` to `y`), not just names — a stronger check than the roadmap asked for. A sanity test asserts it finds all ten, so a reformat of the script fails loudly instead of the parser quietly matching nothing and the other tests passing on empty sets.
**Watch out for:** the parser depends on `VIEWS` entries keeping the shape `name: '…', from: '…', select: '…'` with no commas inside a select expression. If a future view needs `COALESCE(a, b)`, teach the parser first. `ORACLE_VIEWS` notes are hand-written and are NOT compared to the migration's `COMMENT` text — only names and columns are held in step.
**Next:** step 41 — the tool loop

## Step 41 — the tool loop
**Date:** 2026-11-10  **Status:** done
**Built:** `askOracle()`, `ORACLE_MODEL`, `MAX_STEPS`, `OracleStep`, `OracleResult` in `src/server/oracle-service.ts`; `oracle-service.test.ts` (10 tests, `fetch` stubbed). Checked by hand against a real key and real local data: "Who has the most regular-season wins since 2020?" → Gabes, 50, matching a direct SQL query (Gabes 50, Daniel 48, Nate 46); the model queried `standings` and then cross-checked against `games` unprompted.
**Decisions:** `askOracle(question, run = runOracleQuery)` takes the runner as an optional second argument. `vi.mock` cannot intercept a call from one function to another in the same module, and moving the loop to its own file would have contradicted the roadmap's file layout; the route never passes it. The budget is counted in QUERIES, not rounds, so a response carrying three `tool_use` blocks cannot sneak past five; surplus blocks get an `is_error` result telling the model to answer from what it has. The model gets one more turn after the fifth result to answer, and only fails if it asks for a sixth query. Failures surface fixed sentences ("status 529", never the API body), since the body can echo request text.
**Learned:** local Postgres can be given the whole league history with no network: `history:import-workbook`, then `history:import-sleeper`, then `history:picks`, all through `npm run local --`, reading committed files under `data/`. Without that the views are empty and a smoke test proves nothing. The Messages API tool-use shape in the roadmap is correct as written: appending `body.content` unchanged as the assistant turn and replying with `tool_result` blocks keyed by `tool_use_id` worked first time. One real call was ~4,600 input / ~430 output tokens, almost all of it the system prompt.
**Watch out for:** (1) The model sees numeric columns as strings (`"50"`), harmless for reading, and it said so correctly; do not do arithmetic on step rows in the page. (2) `.env.local` holds a real `ANTHROPIC_API_KEY` and the smoke test spends it. (3) `src/lib/oracle-schema.test.ts` first used the regex `s` flag, which `tsc` rejects at this target while vitest accepted it, so `npm test` was green and `tsc` red; run both. (4) Prompt caching is not used. At ~4.6k tokens a question the cost is small; revisit if the daily cap goes up.
**Next:** step 42 — the route

## Step 42 — the route
**Date:** 2026-11-10  **Status:** done
**Built:** `src/app/api/ask/route.ts` (POST only); `DAILY_LIMIT = 30`, `questionsToday()`, `logQuestion()` in `src/server/oracle-service.ts`; `src/server/oracle-route.itest.ts` (4 tests). Checked with `dev:local`: signed out → 401; bad body → 400; signed in → answer plus SQL (Josh Allen over 20 points: 68 of 101 rostered weeks, matching a direct count); a request for PIN hashes and the queue returned no data (the model declined) and was still logged.
**Decisions:** a question that fails (model error, step cap, refusal) is still logged and still counts against the cap, because it still spent tokens. The route answers 200 with `ok: false` for Oracle failures and uses 401/400/429 only for the caller's own problems. A failure to write the log row is swallowed with `console.error` rather than turning a good answer into an error. `steps` are stored trimmed to 20 rows each; the response carries them whole.
**Learned:** the answer correctly applied rule 3 on its own ("while rostered in this league, since 2020") and noticed the name matched one player. The refusal case produced `stop_reason: refusal` from the model before any SQL ran, so it was the model's refusal, NOT the database boundary, that stopped that particular request; the boundary is covered by the itests that send forbidden SQL directly.
**Watch out for:** (1) The cap is checked and then the question is logged AFTER the model returns, so N parallel requests from one signed-in member can all pass the check. The overshoot is bounded by concurrency and costs a few cents; fixing it means inserting a pending row first. Not done. (2) A signed-in member in the local DB was created by claiming a seat through `/api/session` (first claim sets the PIN) — that happens to local data only. (3) `numeric` strings appear in the response `rows`; the page must display them, not add them.
**Next:** step 43 — the page
