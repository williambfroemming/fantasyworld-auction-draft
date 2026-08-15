<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Fantasy Auction Draft

Live auction draft app for a 10-person fantasy football league, replacing a manual Google Sheet.
**The real draft is Friday 2026-08-14.** This is not a toy — ten people will be bidding real budgets in a room, in real time.

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
- **Every mutation is ONE SQL statement, not `SELECT … FOR UPDATE`.** Neon's HTTP driver has no interactive transactions; the transactional version fails at runtime. Awards and trades use data-modifying CTEs so they cannot half-apply.
- **A traded player's salary stays with whoever drafted them.** A trade moves `picks.manager_id`, which would drag the charge along too, so it books an equal-and-opposite pair of `budget_adjustments` to cancel that out. Every trade's adjustments sum to zero — `npm run db:verify` asserts it.
- **`GET /api/state` must stay uncached** — `export const dynamic = 'force-dynamic'` *and* an explicit `Cache-Control: no-store` header. It no longer has side effects, but a cached 204 still strands every client on a stale board and looks like a UI bug.
- **Do not enable `cacheComponents`** in `next.config.ts`. Next 16 *removes* the `dynamic` route-segment config when it's on, which would silently break the rule above. We are deliberately on the "previous caching model."
- **A trade must bump `draft.rev`.** It changes no pick *count*, so it is invisible to the polling fingerprint otherwise. See `src/lib/version.ts`.
- **`autoSlot()` is display-only** and must stay unreachable from any award path. Position slotting must never block a sale.
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
npm run draft:reset      # clear picks/lots/trades/adjustments, back to setup
npm run db:migrate-auction        # the timed-bidding -> called-auction migration (live)
npm run db:migrate-auction -- --test
npm run pins -- --clear
```

> `drizzle-kit push` silently DROPS the `manager_totals` view, which 500s
> `/api/state`. Always use `npm run db:push`, which re-applies it.
>
> **`drizzle-kit push` cannot tell a new table from a rename** and stops to ask
> interactively — which fails outright in a non-TTY. Structural changes go in a
> hand-written, idempotent script instead: see `scripts/migrate-called-auction.ts`.
>
> An env-var prefix does not survive `&&`: `VAR=x a && b` sets VAR for `a` only.
> Use `export VAR; a && b` in any chain that redirects the database URL.
>
> **Next 16 refuses to start a second `next dev` in the same directory.** To smoke-test
> against the test DB you must stop the live-DB server first, or you will drive HTTP
> requests at one database while wiping another.
