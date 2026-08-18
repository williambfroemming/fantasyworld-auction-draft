<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Fantasy Auction Draft

Live auction draft app for a 10-person fantasy football league, replacing a manual Google Sheet.
**The 2026 draft was held Friday 2026-08-14 and is complete — 160 picks, all rosters full.** It is
now an archive the league can browse, and the app keeps every season from here on. This is not a
toy: ten people bid real budgets in a room, in real time.

**The app does not run the auction.** The room calls the bidding out loud, exactly as it always
has; the nominator then records the winner and the hammer price. There is no timer, no
countdown, no live bidding, and no clock sync anywhere in the codebase. If you are about to add
one back, you are undoing a deliberate decision — read `docs/PROJECT_PLAN.md` §3.

Stack: Next.js 16.3 (App Router) · React 19.2 · TypeScript · Tailwind 4 · Neon Postgres + Drizzle · Vercel.

## Read these first

| File | What it is |
|---|---|
| `docs/PROJECT_PLAN.md` | The durable spec — context, locked decisions, rules, architecture, data model, build steps |
| `docs/PROGRESS_LOG.md` | Append-only learnings, one entry per completed step. **Read before starting work** |
| `docs/UAT.md` | Acceptance checklist the user runs against the live deploy |
| `docs/DRAFT_NIGHT.md` | One-page runbook for the commissioner on the night |
| `docs/BACKLOG.md` | Parked ideas for 2027+. **Nothing here is for this season** — park it, don't build it |

## The working rule — follow this on every completed build step

1. Append a full entry to `docs/PROGRESS_LOG.md`, including **Learned** and **Watch out for**. An entry with nothing learned is a smell, not a clean run.
2. Flip that step's box to `[x]` in `docs/PROJECT_PLAN.md` §10.
3. Commit docs alongside the code so the tree and the docs never disagree.
4. Move on. Don't batch several steps and reconstruct the log afterwards — the learnings are the first thing to evaporate.

## Non-negotiables

These look like mistakes and are not. Read `docs/PROJECT_PLAN.md` §4 before changing any of them.

- **Budget and max bid are derived from `picks` + `budget_adjustments`, never stored.** Storing them is exactly how the old sheet ended up with a manager at −1.
- **Every read of `picks` or `lots` is filtered by season.** They hold every draft the league has ever run, ~160 rows a year, forever. `manager_totals` carries the filter for budgets; miss it and each manager starts the new season carrying their whole previous spend — all ten deeply negative, silently, because budgets are derived. Miss it in the pool exclusion and last year's players are undraftable, turning a redraft league into a keeper league. Read `draft.season`; never hardcode a year outside `scripts/migrate-seasons.ts`.
- **A pick stores its own `player_name` / `player_team` / `player_position`.** The pool is re-imported every season, so joining an archived pick to `players` shows a future team on a past board. The live draft may join; the archive never does.
- **`npm run draft:reset` is not how a new season starts.** It erases the current season. Use `npm run season:new -- <year>`, which deletes nothing and moves the finished draft into the archive.
- **Every mutation is ONE SQL statement, not `SELECT … FOR UPDATE`.** Neon's HTTP driver has no interactive transactions; the transactional version fails at runtime. Awards and trades use data-modifying CTEs so they cannot half-apply.
- **A traded player's salary stays with whoever drafted them.** A trade moves `picks.manager_id`, which would drag the charge along too, so it books an equal-and-opposite pair of `budget_adjustments` to cancel that out. Every trade's adjustments sum to zero — `npm run db:verify` asserts it.
- **`GET /api/state` must stay uncached** — `export const dynamic = 'force-dynamic'` *and* an explicit `Cache-Control: no-store` header. It no longer has side effects, but a cached 204 still strands every client on a stale board and looks like a UI bug.
- **Do not enable `cacheComponents`** in `next.config.ts`. Next 16 *removes* the `dynamic` route-segment config when it's on, which would silently break the rule above. We are deliberately on the "previous caching model."
- **A trade must bump `draft.rev`.** It changes no pick *count*, so it is invisible to the polling fingerprint otherwise. See `src/lib/version.ts`.
- **`autoSlot()` is display-only** and must stay unreachable from any award path. Position slotting must never block a sale. Its `overflow` must always be **drawn**, not ignored: a manager who skips the DEFENSE slot has a 16th player with nowhere to sit, and the board grows a bench row for them (`slotRows`). Two managers had an invisible player on the 2026 board because the callers dropped `overflow`.
- **The player queue is private and stays off the polling path.** It must never enter `/api/state` or the fingerprint in `src/lib/version.ts` — a league-wide payload would leak everyone's targets, and widening the fingerprint would make every client's 204 depend on one person's private edit. `/api/queue` takes the manager id from the session cookie and has no id field to send. There are integration tests for both properties.
- **`nominatorAt` has no index cap.** It returns null only when every roster is full. The old `n * rosterSize + n` bound stalled the live 2026 draft with 32 picks left, because a skipped seat consumes an index with no pick behind it. Scan a `2n` window, never `n`.
- **Positional stats group on `players.position`, never the display slot.** A WR shown in FLEX is still a WR, and `positionMarket` excludes K and DEF on purpose (but `SPEND_COLUMNS` keeps them in an OTHER bucket, because a budget row that doesn't total what someone spent is a lie).
- **`nomination_index` is a cursor, not a seat.** `nominatorAt` scans *forward* from it, so the seat it lands on can be several indices later when full rosters are skipped — which means arithmetic on the cursor (`- 1` to undo, `+ 1` to skip) does not do what it reads like. Void and undo restore `lots.nomination_index`; skip advances past `onTheClock.index`. Three functions had this bug; a single nominate-then-void passes either way, so test across a skip run.
- **`sleeper_id` is the only player key that survives a season.** `players.id` is a CSV slug or a Sleeper id and the pool is re-imported yearly, so it dies every August; `resolveSleeperIds` pins a stable one at import and `awardLot` snapshots it onto the pick. It is **nullable on purpose** — the matcher refuses to guess between two same-named players, because a wrong match silently moves one player's price history onto another. Treat null as "unknown", never as an error, and never put it on the draft path.
- **`picks` snapshots `player_rank` as well as name/team/position.** Rank is otherwise recoverable only by joining `players`, and that join dies the moment the next season's CSV replaces the pool. Read it from `pk.`, never the joined `p.` — one source of truth, so live and archive cannot disagree.
- **Money questions attribute to the drafter, via `draftersByPick()`.** A trade moves `picks.manager_id` but not the salary, and `budget_adjustments` can't recover the original buyer because a trade folds salary and cash into one row. The trade log is the only surviving source.
- **The value view compares within a position, never across.** A cross-position comparison doesn't measure value, it just rediscovers that this is a superflex league — every top "overpay" comes out a QB. There's a unit test that fails if this is "simplified".
- **Roster is 16 slots.** `maxBid = budget − (16 − rostered − 1)` → $185 at the start. Getting this wrong skews every bid all draft.
- **No backticks inside the SQL template literals.** They terminate the tagged template and the error surfaces as an unrelated esbuild parse failure.

## Commands

**Live:** https://fantasyworld-auction-draft.vercel.app · **Live DB:** `neondb` · **Test DB:** `neondb_test`

```bash
npm run dev              # local dev (live database)
npm run dev:test         # local dev against the TEST database, /test console enabled
npm test                 # unit tests for the rules engine (vitest)
npm run db:push          # migrations + re-applies the manager_totals view
npm run db:verify        # $200/$185, the reserve invariant, and zero-sum trade adjustments
npm run test:int         # integration tests -- runs against neondb_test only
npm run db:backup        # full JSON snapshot of every table -> backups/
npm run season:list      # what drafts are on record, and which is current
npm run season:new -- 2027   # archive this season, start the next. DELETES NOTHING
npm run draft:reset      # erase THIS season back to setup (not how you start a new year)
npm run draft:record -- "Mario|Aaron Rodgers|1"   # record a sale outside the nomination order
npm run db:migrate-seasons        # the one-draft -> season-per-year migration (live)
npm run db:migrate-seasons -- --test
npm run db:migrate-queue          # adds the private player_queue table
npm run db:migrate-queue -- --test
npm run db:migrate-pick-ranks     # snapshots pool rank onto picks. RE-RUN AFTER EVERY DRAFT,
                                  # BEFORE the next season's rankings CSV is imported
npm run db:migrate-lot-index      # adds lots.nomination_index (no backfill -- see the script)
npm run db:migrate-identity       # players.sleeper_id + picks.player_sleeper_id, resolved
                                  # against Sleeper. RE-RUN AFTER EVERY POOL IMPORT
npm run db:migrate-identity -- --offline   # columns only, no network
npm run pins -- --clear
```

> `drizzle-kit push` silently DROPS the `manager_totals` view, which 500s
> `/api/state`. Always use `npm run db:push`, which re-applies it.
>
> **`drizzle-kit push` cannot tell a new table from a rename** and stops to ask
> interactively — which fails outright in a non-TTY. Structural changes go in a
> hand-written, idempotent script instead: see `scripts/migrate-seasons.ts`.
>
> **`scripts/migrate-called-auction.ts` is superseded and refuses to run** once
> `draft.season` exists. It ends by rebuilding `manager_totals` from a copy frozen
> before seasons, so running it now would silently strip the season filter and
> bankrupt every manager. A migration that hardcodes a view definition ages into a
> loaded gun; guard it rather than trusting the order it gets run in.
>
> An env-var prefix does not survive `&&`: `VAR=x a && b` sets VAR for `a` only.
> Use `export VAR; a && b` in any chain that redirects the database URL.
>
> **Next 16 refuses to start a second `next dev` in the same directory.** To smoke-test
> against the test DB you must stop the live-DB server first, or you will drive HTTP
> requests at one database while wiping another.
