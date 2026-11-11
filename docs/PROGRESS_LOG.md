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
