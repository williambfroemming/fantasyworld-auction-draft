# Backlog — 2027 season and beyond

> **Nothing in this file is for draft night.** This is the parking lot for ideas
> that arrive mid-build and mid-draft, so they don't turn into a risky change on
> a deadline. Read `PROJECT_PLAN.md` for the durable spec first — the
> non-negotiables in §4 constrain most of what's below.

Add to this freely. An item here costs nothing; the same item attempted in
August costs the draft.

**Section numbers are load-bearing.** Roughly a dozen source comments cite
`docs/BACKLOG.md §N` (`src/lib/draft.ts`, `src/server/queue-service.ts`,
`src/components/LotPanel.tsx`, …). Sections that ship get collapsed to a stub,
**never renumbered and never deleted.**

---

## What is actually open

Everything else in this file shipped between 2026-08-15 and 2026-08-16; those
sections are now stubs pointing at `PROGRESS_LOG.md`.

| # | Item | Size | Where |
|---|---|---|---|
| §9 P2 | `voidLot` / `undoPick` decrement `nomination_index` by exactly 1 | Small, has a real fix | [commish-service.ts:102](src/server/commish-service.ts#L102), [:199](src/server/commish-service.ts#L199) |
| §9 P1 | `draft.status` never flips to `'done'` on its own | Small | [draft-service.ts](src/server/draft-service.ts) award path |
| §7 | Cumulative spend curve on `/stats` | Medium — needs a new visual primitive | `src/components/` |
| §4 | Queue drag-to-reorder, and nominate straight from the queue | Small each | `src/components/PlayerPool.tsx` |
| §7 | Per-manager positional split on the draft screen itself | Small | `SidePanel.tsx` My Roster |
| §2 | `players.id` identity across pool imports | Medium, and blocks cross-year price queries | shared with §1 |
| §1 | Player news feed | Large, and July-2027 work at the earliest | not started |
| §8 | Mobile layout · push to Sleeper · accessibility pass | Unspecified | — |

**The two P-items are the top of the list**, in that order — they are bugs in a
finished system rather than new surface, and both are half a day.

---

## 1. Player news feed

**Want:** click a player anywhere in the app — pool, open lot, League board —
and see current news for them. "Is this guy hurt?" is the question managers
currently answer by alt-tabbing to Rotowire mid-auction, which is exactly the
kind of context the app should own.

**Status: not started.** Notes below are design work already done, not a
commitment to an approach.

### The hard part is player identity, not the feed

`players.id` is **not a stable cross-provider key today.** From
`src/db/schema.ts`:

> `id` is the Sleeper player_id when synced from Sleeper, or a derived slug for
> CSV imports.

And per `PROJECT_PLAN.md` §9, the FantasyPros CSV import is the *recommended*
seeding path, not the fallback — so in practice the pool is keyed by slugs that
no news provider has ever heard of. Whatever provider gets picked, something has
to map `"Puka Nacua" / LAR / WR` to that provider's ID.

The cheapest fix is at the seam we already control: make the CSV import
**resolve every row against the Sleeper pool** and store the Sleeper ID
alongside the slug, so there is one real identifier per player regardless of how
the pool was seeded. That is worth doing on its own merits — it also makes
re-importing a corrected CSV non-destructive, and it is the same work §2 needs
for cross-year price comparisons.

⚠️ Name matching will not be clean. Suffixes (Jr./III), apostrophes, `D/ST` vs
`DEF` vs `DST`, and team defenses keyed by abbreviation (`"PHI"`) all break naive
equality — `src/lib/sleeper.ts` already carries tested normalizers for some of
this, so extend those rather than writing a second matcher. Budget for a
**manual override table** for the 5–10 players that never match; do not budget
for a matcher that gets to 100%.

### Provider — decide by verifying, not from memory

Whoever picks this up in **July 2027** should re-check availability and terms
first; fantasy news APIs churn constantly and any list written in 2026 will be
stale. Shape of the options:

| Kind | Notes |
|---|---|
| Paid/licensed API (Rotowire, FantasyPros, Sportradar) | Cleanest data, real player IDs, has a contract and a cost |
| Public RSS / undocumented endpoints (ESPN, aggregator feeds) | Free and quick, no stability guarantee, can vanish between seasons |
| Sleeper | Already a dependency and already synced — check whether it exposes news at all before assuming it does |

For a 10-person private league, a free feed that breaks in the offseason is
probably acceptable **as long as it degrades to an empty panel**, not an error.

### Non-negotiables this feature must respect

These are not suggestions — they're the rules in `PROJECT_PLAN.md` §4 applied to
this feature.

1. **News never touches `/api/state`.** That route is polled by every client and
   is `force-dynamic` + `no-store`. Adding a third-party fetch to it puts
   someone else's uptime on the critical path of every award. News gets its own
   route.
2. **Never fetch a provider from a request path on draft night.** Same rule
   `PROJECT_PLAN.md` §9 puts on Sleeper's 5MB pool dump. Either pre-fetch news
   for the whole pool at setup, or cache aggressively per-player with a TTL
   measured in minutes.
3. **A dead provider must be invisible, not fatal.** Model it on `autoSlot()`:
   display-only, deliberately unreachable from any bid path. A timeout shows an
   empty news panel and the auction continues.
4. **News is not a ranking.** The board deliberately drops tiers and auction
   values (`PROGRESS_LOG.md` step 9b) because they're one source's opinion.
   Headlines are facts and fit that rule; a provider's "start/sit" verdict or
   projected value does not. Don't let the feed smuggle opinions back onto the
   board.

### UI collision — mostly resolved by §4

The original worry was that a click on a player row in
`src/components/PlayerPool.tsx` **already means "select for nomination"**, and
the row is `disabled` entirely when it isn't your turn — while the value of news
is highest precisely when it *isn't* your turn.

§4 shipped the answer: the queue star is a **sibling button** that stays live
while the row is disabled. A news affordance can be a second sibling, or open a
**player detail drawer** with three entry points (pool row, `LotPanel`,
`LeagueBoard`). Hover cards remain ruled out — cheap to build, bad on the one
night that matters, and untestable.

**Do this before draft week, or not at all.** A feature that adds a network
dependency and a new interaction to the pool is a Wednesday-in-July change.

---

## 2. ✅ Draft history — every season kept and browsable by year

**BUILT 2026-08-15** — `PROGRESS_LOG.md` step 17. `season` on every per-draft
table, season-scoped `manager_totals`, the name/team/position snapshot on
`picks`, `UNIQUE (season, player_id)`, `season_orders`, `/api/archive`, the year
picker on `/board`, `season:new` / `season:list` / `db:backup` / `draft:record`,
and 13 integration tests in `src/server/season-archive.itest.ts`.

The rules that came out of it are now permanent, in `AGENTS.md` §Non-negotiables
and `PROJECT_PLAN.md` §4 — season-filter every read of `picks` and `lots`, and
never join an archived pick back to `players`.

**Still open:**

- **`players.id` identity across imports.** Untouched — it is the §1 problem. The
  denormalized display fields sidestep it for the archive, but a cross-year "what
  did this player cost in 2026 vs 2027" query still has nothing reliable to join
  on. Single-season stats are unaffected.
- **Bye weeks are null in the archive**, deliberately — they belong to a finished
  season and the only source is today's pool. Not a defect; don't "fix" it.
- **Nothing prunes `backups/`.** Three files. They are gitignored as of commit
  8ea23f6 (they dump `managers`, PINs included), so they no longer grow the repo
  — revisit only if the local directory gets unwieldy.

---

## 3. ✅ Average remaining budget

**BUILT 2026-08-15** — `PROGRESS_LOG.md` step 18. `RoomMoney` in
`SidePanel.tsx` shows both the mean budget among managers who can still bid and
dollars per open slot league-wide; full rosters are excluded from both. Pure
render, exactly as predicted — no schema, no query, no API change.

`perSlotLeft()` in `src/lib/stats.ts` later became the shared definition behind
both this and the Budgets `$/slot` column (step 20).

**Nothing open.**

---

## 4. ✅ Personal player queue

**BUILT 2026-08-15** — `PROGRESS_LOG.md` step 18. Season-scoped `player_queue`
table, session-scoped `/api/queue`, a star on every pool row, drafted targets
struck through and counted rather than silently removed.

Privacy was the whole feature and is now a non-negotiable in `AGENTS.md`: the
queue never enters `/api/state` or the fingerprint in `src/lib/version.ts`, and
two integration tests pin exactly that.

**Still open:**

- **Drag-to-reorder.** `player_queue.sort_order` exists and is honoured by
  `queue-service.ts`, but nothing writes it except append — entries keep
  insertion order.
- **Nominate straight from the queue.** The ★ filter shows the list, but
  selecting from it still goes through the normal row-select. This was called
  "the payoff" when the section was written, and it is still the cheapest
  remaining win in the file after the two P-items.

---

## 5. ✅ "On deck" — who nominates next

**BUILT 2026-08-15, widened 2026-08-16** — `PROGRESS_LOG.md` steps 18 and 20.
`/api/state` carries `onDeck`; the draft screen shows an order strip of the next
nine via `upcomingOrder()`, with round numbers so the snake turn reads as
deliberate.

The original "show one name only" argument was right about *certainty* and wrong
about *usefulness*: everything past on-deck is a projection, so the strip dims
and labels the tail rather than pretending. `upcomingOrder` deliberately does not
simulate purchases — it cannot know who wins the next lot, and anyone
"improving" it that way would be inventing data.

**Nothing open.**

---

## 6. ✅ Drafted players and prices by position

**BUILT 2026-08-15** — `PROGRESS_LOG.md` step 18.
`src/components/MarketPanel.tsx`, on `/board` behind a Board/Market toggle, plus
a compact own-spend line in My Roster. Groups on `players.position`, leads with
the median, excludes K/DEF, and works for archived seasons.

The 2026 numbers show why the median mattered: RB mean $13.4 against a **$7
median**; QB median $14, WR $7, TE $3.

**Nothing open.**

---

## 7. ✅ Team spend analysis — who is spending how much on what

**BUILT 2026-08-16** — `PROGRESS_LOG.md` step 19. It became the **Teams** view on
a new `/stats` page, alongside three views this file never considered: **Pace**,
**Nominations** (reading `nominatorId`, which nothing had ever read), and
**Value** (gated until every roster is full).

Two durable results, both now in `AGENTS.md`: money attributes to the **drafter**
via `draftersByPick()`, because a trade folds salary and cash into one
`budget_adjustments` row and cannot be un-mixed; and `picks.player_rank` /
`player_pos_rank` are snapshotted at award time, because rank is otherwise only
recoverable by joining `players` and that join dies at the next pool import.

**Still open:**

- **The cumulative spend curve.** Deliberately deferred — it is the only view
  here that needs a new visual primitive.
- **A per-manager positional split on the draft screen itself.** `/stats` has the
  10 × 4 matrix; the draft-screen sidebar still shows only your own totals.
  ⚠️ The reason it isn't there already stands: the draft screen gives its space
  to the lot (commit 725518d), and a 19rem sidebar does not fit a wide grid —
  step 20 clipped a column just by adding a sixth. Keep it to one compact line.

---

## 8. Also raised, not yet specified

| Item | Note |
|---|---|
| Mobile / tablet layout | Explicitly out of scope for 2026 (`UAT.md`) because everyone drafts on a laptop. If that changes, the League grid and the award controls are the two things to re-check. |
| Push rosters to Sleeper | Today the draft ends at a CSV (`/api/export`). Pushing results into Sleeper directly would need league write auth — a much bigger ask than the read-only pool sync. Note this is *not* the archive: §2 supersedes exporting-as-preservation. |
| Accessibility pass | Never audited. Worth doing before anyone drafts on something other than a laptop. |

**Removed from this table:** the draft recap page. `/stats` (§7) plus the `/board`
year picker (§2) are that feature — every past season is browsable and scored,
and `lots` / `picks` / `trades` are all read after the draft now.

---

## 9. From draft night 2026

The rehearsal and the live draft find what tests can't. **Append here the same
night or the next morning**, while it's still specific. For each one, write what
happened and what it would take to fix — not just "nomination was confusing." A
vague item here is an item nobody picks up.

### ✅ P0 — the draft stalled near the end with nobody on the clock — FIXED 2026-08-15

`nominatorAt` capped its search at `n * rosterSize + n` = 170 indices for a
160-pick draft, but `nominationIndex` is not a pick counter — every *skipped*
seat consumes an index too. Once 9 of 10 managers are full, reaching the last one
can burn ~10 indices per pick, so the 10-index margin was gone long before the
draft was. It stalled at index 170 with **32 picks still to make**.

**FIXED** in `PROGRESS_LOG.md` step 18: return `null` only when every manager is
at `rosterSize`, and otherwise scan a `2n` window with no absolute cap. The `2n`
matters — a window of `n` straddling a snake turn can miss a seat entirely.
Now an `AGENTS.md` non-negotiable, with the full reproduction and the regression
suite in [draft.test.ts:125](src/lib/draft.test.ts#L125).

Worth remembering why it shipped at all: run the regression suite against the
*old* code and the even and mildly-lumpy draft shapes **still pass**. They are
the two anybody would have written first. Only the realistic skewed shape fails.

### 🟡 P1 — "complete" and "stuck" are the same state on screen — MOSTLY FIXED 2026-08-15

`onTheClock: null` meant both *finished* and *the app has lost track of whose
turn it is*, which is why the stall read as a freeze on the night.

**Fixed on screen.** `LotPanel` renders three distinct states — a "Draft
Complete!" panel, an explicit **"Nobody on the clock — N slots still unfilled,
this is a fault"** warning, and the normal view with a picks-made / to-go
counter. See [LotPanel.tsx:85](src/components/LotPanel.tsx#L85).

**Still open: `draft.status` is never flipped to `'done'` automatically.**
`setStatus` is only ever called by hand from
[commish-service.ts:204](src/server/commish-service.ts#L204) or `draft:record`,
so the database still only learns the draft ended when someone says so. The UI
is unaffected — every consumer that matters already keys off "is anybody
unfilled?" rather than the flag, deliberately, because the flag lags and an
archived season has no live status ([stats.ts:344](src/lib/stats.ts#L344)).

So this is now a **data-tidiness bug, not a UI bug**: flip it in the award path
when the last slot fills. Keep the "is anybody unfilled?" checks as they are —
do not make them trust the flag.

### 🟡 P2 — `voidLot` and `undoPick` decrement the index by exactly 1

**Still open, and the top item in this file.**

Both do `nomination_index = GREATEST(0, nomination_index - 1)` —
[commish-service.ts:102](src/server/commish-service.ts#L102) and
[:199](src/server/commish-service.ts#L199) — but nomination may have advanced the
index by more than 1 when it skipped full seats. The decrement therefore lands
mid-skip-run rather than back on the seat that nominated.

It self-heals (the next scan skips forward again) and it did not cause the P0
stall, but it means "undo" does not reliably hand the turn back to the manager
who just had it — which is the entire point of undo, and it is worst at the end
of a draft, when skip-runs are longest and a mistake is most likely to need
undoing.

**The fix:** don't guess backwards from the index. Either store the index the lot
was nominated *at* on `lots` and restore it exactly, or scan backwards for the
previous seat with the same "is anybody unfilled?" logic `nominatorAt` now uses.
The stored-index version is the honest one and is a column plus a write.

⚠️ Both call sites are single-statement mutations by design (Neon's HTTP driver
has no interactive transactions). A restore-from-`lots` fix has to stay one
statement — a data-modifying CTE, like awards and trades.

**Test it either way**, whichever fix lands: `src/lib/draft.test.ts` has
end-of-draft coverage now, but nothing exercises void/undo across a skip-run.
