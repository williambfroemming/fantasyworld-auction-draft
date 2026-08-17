# Backlog — 2027 season and beyond

> **Nothing in this file is for draft night.** This is the parking lot for ideas
> that arrive mid-build and mid-draft, so they don't turn into a risky change on
> a deadline. Read `PROJECT_PLAN.md` for the durable spec first — the
> non-negotiables in §4 constrain most of what's below.

Add to this freely. An item here costs nothing; the same item attempted in
August costs the draft.

> ✅ **§2–§6 and §9's P0/P1 were built on 2026-08-15**, after the 2026 draft
> finished. Each section keeps its original design notes and gains a **Status**
> line saying what shipped and what is still open. Two consequences for anyone
> picking this up:
>
> - **Seasons exist.** `picks` and `lots` span every year the league has run, so
>   **every query against them must filter on `draft.season`.** Read §2's "What
>   shipped" first — some notes below still describe the old single-draft shape.
> - **The private queue must never reach `/api/state` or the polling
>   fingerprint.** There are tests for both; see §4.
>
> Still genuinely open: **§1** (news feed), **§8**, and **§9's P2**, which is now the
> highest-value item in the file.

---

## 1. Player news feed

**Want:** click a player anywhere in the app — pool, open lot, League board —
and see current news for them. "Is this guy hurt?" is the question managers
currently answer by alt-tabbing to Rotowire mid-auction, which is exactly the
kind of context the app should own.

**Status:** not started. Notes below are the design work already done, not a
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
re-importing a corrected CSV non-destructive.

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

### UI collision to resolve first

In `src/components/PlayerPool.tsx` a click on a player row **already means
"select for nomination"** (`setSelected`), and the row is `disabled` entirely
when it isn't your turn. "Click a player to see news" cannot reuse that gesture
— and the value is highest precisely when it *isn't* your turn and you're
deciding what to bid.

Options, roughly in order of preference:
- A small info affordance on the row that opens a **player detail drawer**,
  leaving row-click as nominate.
- A detail drawer reachable from the open lot in `LotPanel.tsx` and from a
  player cell in `LeagueBoard.tsx` — the drawer is one component with three
  entry points.
- Hover cards. Cheap to build, bad on the one night that matters, and
  untestable — mentioned only to be ruled out.

**Do this before draft week, or not at all.** A feature that adds a network
dependency and a new interaction to the pool is a Wednesday-in-July change.

---

## 2. ✅ Draft history — every season kept and browsable by year

**Want:** each draft is preserved as its own instance, so the league can go back
and look at any past year. A year filter on the board: 2026, 2027, 2028.

**This is not a keeper feature.** Nothing carries forward — no player, no price,
no budget. The league is not a keeper league. The only thing that persists is
the *record*.

**Status: BUILT, 2026-08-15.** See `PROGRESS_LOG.md` step 17. The design notes
below turned out to be right and are kept as the record of *why* it is shaped
this way; **"What shipped" and "Still open" at the end of this section are the
current state.**

### ✅ The 2026 draft is no longer one command from being deleted

It was, and that risk was real: `npm run draft:reset` deleted
`budget_adjustments`, `trades`, `picks`, and `lots` outright, and that was the
documented way to start a new draft.

Now: `draft:reset` is scoped to the current season and refuses over 30 picks
without `--force`; `npm run season:new -- <year>` is the way to start a year and
deletes nothing; and `npm run db:backup` writes a full JSON snapshot of every
table. Two snapshots are committed under `backups/`, one taken before the
migration and one after.

### Shape: a season column, not a second set of tables

Add a season year to the tables that are per-draft — `picks`, `lots`, `trades`,
`budget_adjustments`, and `draft` — and "reset" becomes *start a new season*
instead of *delete everything*. Past rows simply stop matching the current
season filter.

A separate `drafts` table (id, year, label) with foreign keys is the more
"correct" modelling and would allow two drafts in one year, which this league
will never need. For ten people, a plain `season INTEGER` is the right amount of
machinery.

### ⚠️ The dangerous part: `manager_totals` must be season-scoped

Budget derives from `picks` through the `manager_totals` view. If picks
accumulate across seasons and that view is not filtered to the current one, then
on the first nomination of 2027 every manager's budget already carries their
entire 2026 spend — **every manager starts deeply negative.** That is the exact
−$1 failure the whole app exists to prevent, arriving through a new door.

Consequences:

- The season filter belongs in `manager_totals` itself, not in each caller.
  One place to get right, and `npm run db:push` already re-applies the view.
- `npm run db:verify` should assert $200 / $185 **for the current season**, and
  that assertion is what would catch a missed filter.
- Anything else reading `picks` or `lots` needs the same scoping — the pool
  exclusion ("already drafted") very much included, or 2026's players stay
  undraftable forever.

### ⚠️ Archived drafts must not re-render with this year's data

`picks.playerId` references `players.id`, and the player pool is **re-imported
every season** from a fresh FantasyPros CSV or Sleeper. Two problems follow:

1. A player's team changes between seasons. A 2026 pick rendered by joining to
   today's `players` row would show their 2028 team — quietly rewriting history.
2. If a yearly import ever *deletes* rows (retirements), archived picks lose
   their player entirely, or the foreign key blocks the import.

Fix both by **denormalizing name, team, and position onto the pick at award
time**. The archive then renders from what was true that night, and the yearly
import stays free to change the pool. Make the import upsert-only regardless —
never delete player rows that a past draft references.

Related: `players.id` is a Sleeper ID *or* a derived CSV slug, so the same
player may not keep the same key across imports. That's the identity problem
from §1, and denormalizing the display fields sidesteps it for the archive even
if it's never fully solved.

### Draft order is overwritten each season too

`managers.draftSlot` is re-drawn at setup every year and overwritten in place,
so past draft orders are lost as soon as the next season is set up. If "who
picked where in 2026" is part of what's worth keeping, the season's order has to
be stored per-season rather than only on the manager row.

### The view itself

A year picker on `/board`, rendering a past season read-only — same grid, no
nominate, no award. `/board` is already the wide, dense screen (commit 725518d),
so the archive belongs there rather than on the draft screen. Once past seasons
are queryable, the recap page in §8 and cross-year price comparisons for §6/§7
become straightforward instead of impossible.

---

### ✅ What shipped

- `season` on `draft`, `picks`, `lots`, `trades`, `budget_adjustments`, backfilled
  to 2026. `draft.season` is the single source of "which year is current"; no app
  code hardcodes a year.
- **`manager_totals` is season-scoped.** `npm run db:verify` asserts $200/$185 for
  the current season *and* that the view's rostered totals equal this season's
  pick count — that second check catches a missed filter in either direction.
- `picks` carries `player_name` / `player_team` / `player_position`, copied in at
  award time. The archive renders from those and never joins to `players`.
- **`picks_player_idx` became `UNIQUE (season, player_id)`.** This was the
  load-bearing piece and the least obvious: without it, seasons would exist and
  every player drafted in 2026 would still be undraftable forever.
- New `season_orders` table — seat, display name, and colour per manager per
  season, so a rename or a re-draw can't relabel a finished draft.
- `npm run season:new -- 2027`, `npm run season:list`, `npm run db:backup`,
  `npm run draft:record`.
- `/api/archive`, a year picker on `/board`, and `/api/export?season=2026`.
- 13 integration tests in `src/server/season-archive.itest.ts`.

### Still open

- **`players.id` identity across imports** is untouched — the §1 problem. The
  denormalized display fields sidestep it for the archive, but a cross-year "what
  did this player cost in 2026 vs 2027" query still has nothing reliable to join
  on. §6/§7 within one season are unaffected.
- **Bye weeks are null in the archive**, deliberately — they belong to a finished
  season and the only source is today's pool.
- **Nothing prunes `backups/`.** Two files today; revisit at twenty.
- The recap page (§8) and cross-year comparisons (§6/§7) are now *straightforward*
  rather than impossible, but none are built.

---

## 3. ✅ Average remaining budget

**Want:** show what the rest of the room has left, so a manager can tell whether
they're rich or poor relative to the field — and whether the next twenty players
are about to go cheap or expensive.

**Status: BUILT, 2026-08-15** — see `PROGRESS_LOG.md` step 18. It was indeed the
smallest item here. `RoomMoney` in `SidePanel.tsx` shows **both** numbers: mean
budget among managers who can still bid, and dollars per open slot league-wide.
Managers with a full roster are excluded from both. Pure render — no schema, no
query, no API change, exactly as predicted below.

### It costs nothing to compute

`/api/state` already sends `budget`, `rostered`, and `maxBid` for all ten
managers on every poll — see `StateManager` in
[draft-service.ts:22-33](src/server/draft-service.ts#L22-L33). The average is a
client-side reduce over `state.managers`. **No schema, no new query, no API
change, no change to the polling fingerprint.** It is a rendering task.

### Decide which average, because they say different things

| Number | Answers |
|---|---|
| Mean budget across managers | "Am I rich or poor right now?" |
| **Dollars left per unfilled roster slot, league-wide** | "Is the market about to inflate or crash?" |
| Mean among managers who can still bid | The honest version of the first |

The per-unfilled-slot figure is the most decision-useful of the three and the
one the old sheet could never show; the plain mean is the most immediately
readable. Showing both on one line is probably right. **Pick deliberately** —
shipping an unlabelled "average" that turns out to be the least useful of the
three is the likely failure here.

⚠️ **Exclude managers with a full roster from anything labelled "the room."** A
manager at 16 cannot bid, so their leftover money is dead and will never compete
for another player. Folding it into an average overstates what's actually
chasing the next nomination. This is the same "skip managers who are full" rule
`snakeOrder()` already applies.

⚠️ **Derive at render; never store it.** It's a number about budgets, so it
lives under the same rule as budget itself.

Home for it is the Budgets panel in `SidePanel.tsx`. It's an at-a-glance number
for a room that is already talking out loud — resist building a chart.

---

## 4. ✅ Personal player queue

**Want:** star players you're targeting and have them pinned or filtered in the
pool, so when your nomination comes up you aren't scrolling a 500-row list with
nine people watching you.

**Status: BUILT, 2026-08-15** — see `PROGRESS_LOG.md` step 18. The table
(`player_queue`, season-scoped), the session-scoped `/api/queue`, and a star on
every pool row. **Built without §1**: the click collision is solved by making the
star a sibling button rather than needing a detail drawer, so the two are no
longer coupled.

Two integration tests pin the privacy properties directly — that no queued player
id appears anywhere in `getState()`, and that queue edits leave the polling
fingerprint unchanged. Drafted targets are struck through and counted rather than
silently removed, with a Clear button.

Still open: **drag-to-reorder** (entries keep insertion order) and **"nominate
straight from your queue"** — the ★ filter shows the list, but selecting from it
still goes through the normal row-select.

### Privacy is the whole feature

A queue anyone else can see is worse than no queue — it broadcasts your
strategy to the people bidding against you. Two hard consequences:

- **It must never enter `/api/state`.** That payload is league-wide and every
  client receives all of it.
- If it lives server-side, it is read through a session-scoped route that
  returns **only the caller's own rows**, keyed off the existing PIN cookie
  (`src/server/session.ts`).

### Storage: `localStorage` or a table

`localStorage` needs no backend and is private by construction, but it dies when
someone switches laptops or clears their browser — and it fails *on draft
night*, which is the only night it matters. A `queue` table
(`managerId, playerId, sortOrder`) survives that and is a small amount of code.
**Recommend the table**, on failure-mode grounds rather than feature grounds.

### ⚠️ The queue does not belong in the polling fingerprint

`src/lib/version.ts` composes `rev : lotId : pickCount : status` — deliberately
values that every mutation already touches, so there is no bump discipline to
forget. A private queue edit touches none of them, and widening the fingerprint
to cover it would make **every** client's 204 depend on one person's private
edits. Queue reads and writes go on their own route, outside the poll entirely.

### Auto-pruning is the real requirement

Players get bought all night. A queue still listing three players who sold an
hour ago is actively worse than no queue. The pool already excludes drafted
players; the queue view must apply the same exclusion — and it should **say**
"2 of your targets were drafted" rather than silently shrinking, because a queue
that quietly empties itself reads as a bug.

### Same click collision as §1

Row click in [PlayerPool.tsx:106](src/components/PlayerPool.tsx#L106) already
means "select for nomination," and rows are disabled when it isn't your turn —
which is precisely when someone would be building a queue. The star needs its
own affordance that works while disabled. Whatever player detail drawer §1
introduces is the natural home for a queue toggle: **build these two together**,
since separately they each need the same new interaction and would fight over
the same gesture.

Once it exists, "nominate straight from your queue" is the payoff.

---

## 5. ✅ "On deck" — who nominates next

**Want:** alongside whoever is on the clock, show the single league member who
nominates next, so everyone can see who's on deck.

**Status: BUILT, 2026-08-15**, and **widened on 2026-08-16** (step 20). The
single `onDeck` name is still carried on `/api/state`, and the draft screen now
also shows an order strip of the next nine via `upcomingOrder()`.

The "one name only" argument below was right about the *certainty* and wrong
about the *usefulness*: seats beyond the next one are a projection, so the strip
dims and labels everything past on-deck rather than pretending. See step 20.

Both surfaces call out the snake turn — the lot panel says "again — the order
turns here", and the strip puts a round number beside each name so the same
manager appearing twice in a row reads as deliberate. **§9's P0 was fixed
first**, as this section said it had to be.

### Why one name is the right scope

- **The snake turn is the confusing part.** At the end of each round the same
  manager nominates twice in a row, which reliably produces "wait, isn't it my
  turn?" in the room. Showing who's on deck settles that without anyone
  re-deriving the order out loud.
- The next nominator can start thinking before their turn lands, which is most
  of why the personal queue (§4) is worth pairing with this.
- **It stays accurate.** Looking several seats ahead is guesswork, because who
  nominates later depends on who fills their roster before then. One seat ahead
  is right in every case except one (below), and that case self-corrects.

### Reuse `nominatorAt` — do not re-implement the snake

`nominatorAt(managers, index, rosterSize)` in `src/lib/draft.ts` already returns
the seat at any index and skips full rosters, so on-deck is one more call at
`onTheClock.index + 1`. It's pure, DB-free, and client-importable, and
`/api/state` already carries `managers` (with `rostered`) plus `nominationIndex`
— so **no schema and no API change**. Adding it to the `/api/state` payload
next to `onTheClock` is equally cheap if that reads better.

⚠️ Writing a second copy of the snake maths for the UI is how the displayed
order and the enforced order drift apart. One implementation, called twice.

### The one case where on-deck changes

If the manager who wins the current lot thereby fills their 16th slot, they get
skipped, and on-deck moves on. That's the only way the name changes without a
nomination happening — and since the turn is recomputed on every read
(`draft-service.ts`), it corrects itself on the next poll with no extra work.
It's worth knowing it can flicker at the very end of a draft rather than
treating that as a bug.

**Fix §9 first.** On-deck reads through the same index bound that stalls the
draft, so it would just show the failure one seat early.

---

## 6. ✅ Drafted players and prices by position

**Want:** filter what's already been drafted by position, and see the money that
went to each — what the QBs actually cost, whether RBs are going over book, how
much is left on the board at a position.

**Scope: QB, RB, WR, TE only.** K and DEF are excluded deliberately — they go
for a dollar or two, nobody's strategy turns on them, and including them drags
every league-wide number toward the floor. Four positions, not six.

**Status: BUILT, 2026-08-15** — see `PROGRESS_LOG.md` step 18.
`src/components/MarketPanel.tsx`, on `/board` behind a Board/Market toggle, plus
a compact own-spend line in My Roster. Groups on `players.position`, leads with
the median, and excludes K/DEF. Works for archived seasons too (without the
"still in the pool" column, which a finished draft has no answer for).

The 2026 numbers show why the median mattered: RB mean $13.4 against a **$7
median**, QB median $14, WR $7, TE $3.

§7 (the same money cut by manager) is **not** built — it is the 10 x 4 matrix,
and it is now a regrouping of a result set that already exists.

### The data is all there

`picks` holds `price`, and joins to `players.position`. `/api/board` already
ships full rosters and the pool. A positional summary — count, min / median /
max / average spend, dollars still uncommitted — is a group-by over data every
client already has, filtered to the four positions. No schema change.

### ⚠️ Group by the player's position, never by their roster slot

`autoSlot()` and `slotOverride` are display-only, and a player shown in FLEX,
SUPERFLEX, or BENCH still *is* a WR. Grouping by grid row would scatter one
position across three buckets and let a display concern leak into a number
people make bidding decisions on — precisely what §4 of the plan keeps
`autoSlot()` away from. Group on `players.position`.

**Median beats mean** here. One $70 panic buy drags an average enough to
mislead, and positional spend is exactly the kind of small, skewed sample where
that happens.

### Pairs with the rest of the market-awareness set

§3 (average remaining budget) answers "how much money is left"; this answers
"what has it been going to"; §7 answers "who is spending it." Same trip through
the data for all three — build them together. Kept after the draft, this is also
most of the recap page in §8.

---

## 7. ✅ Team spend analysis — who is spending how much on what

**Want:** per manager, where their money has actually gone — how much of a
budget went to RBs vs WRs vs QBs vs TEs, and how much is still uncommitted.
§6 is the league-wide market; this is the same money cut by team.

**Status: BUILT, 2026-08-16** — see `PROGRESS_LOG.md` step 19. It became the **Teams** view on a
new `/stats` page, alongside three views this file never considered: **Pace** (the market's price
curve and who is ahead of it), **Nominations** (reading `nominatorId`, which had never been read by
anything), and **Value** (bargains and overpays against the room's own bidding, gated until every
roster is full).

The "which question does it answer" warning below turned out to be the load-bearing part: it
attributes to the **drafter** and says so on screen. Note `budget_adjustments` cannot recover the
original buyer — a trade folds salary and cash into one row per manager — so `draftersByPick()`
rewinds the trade log instead.

Also built: `picks.player_rank` / `player_pos_rank`, snapshotted at award time. Without it a
finished season can never be scored again, because rank is otherwise only recoverable by joining
`players` and that join dies at the next pool import.

Still open: the **cumulative spend curve** (deliberately deferred — the only view needing a new
visual primitive), and a per-manager positional split on the draft screen itself.

### Panel or page? — a page (or a tab on `/board`)

Asked directly, my answer is **not a draft-screen panel**, for two reasons the
repo already settled once:

- **The draft screen deliberately gives its space to the lot.** Commit 725518d
  ("Make the lot the centrepiece; move the League board to `/board`") moved the
  wide, dense view *out* precisely because it crowded the thing people are
  actually bidding on. A 10-manager × 4-position grid is that same shape of
  view, and putting it back in the side panel re-fights a decision that was
  already made for good reason.
- **The side panel is narrow and already carries My Roster and Budgets.** Ten
  rows × four positions plus totals does not read at that width, and squeezing
  it in makes the two tabs that matter during bidding worse.

**Recommended split:**

| Where | What |
|---|---|
| `/board`, as a tab or section | The full 10 × 4 matrix — everyone's spend by position, with totals and remaining |
| Draft-screen side panel | **Your own** split only, one compact line in My Roster — "RB $88 · WR $61 · QB $14 · TE $9" |

That keeps the at-a-glance version where you're bidding and the comparison
version where there's room. `/board` is already the second screen people leave
open on a laptop, which is exactly the audience for this.

### Same query as §6, grouped one level deeper

It's `picks` joined to `players`, grouped by manager and position instead of
position alone — the same data `/api/board` already ships. **No schema change**,
and if §6 is built first this is a regrouping of a result set that already
exists. Build them together.

### Notes

- **Same four positions as §6** (QB, RB, WR, TE), and the same rule: group on
  `players.position`, never on the display slot.
- **Show unspent money as its own column.** "Spent $180 of $200" is the number
  that makes a row comparable; positional splits alone hide who is broke.
- ⚠️ **Traded players make "spend" ambiguous.** A trade moves `picks.managerId`
  but leaves the salary with whoever drafted the player, via the paired
  `budget_adjustments`. So a manager's roster and their spending are genuinely
  different sets after a trade. Decide which question the view answers — "what
  is on my team" or "what did I pay for" — and label it. Summing `picks.price`
  over current `managerId` silently answers *neither*.

---

## 8. Also raised, not yet specified

| Item | Note |
|---|---|
| Mobile / tablet layout | Explicitly out of scope for 2026 (`UAT.md`) because everyone drafts on a laptop. If that changes, the League grid and the award controls are the two things to re-check. |
| Push rosters to Sleeper | Today the draft ends at a CSV (`/api/export`). Pushing results into Sleeper directly would need league write auth — a much bigger ask than the read-only pool sync. Note this is *not* the archive: §2 supersedes exporting-as-preservation. |
| Draft recap page | `lots`, `picks`, and `trades` already hold the whole story — hammer prices, who nominated what, what moved afterwards — and nothing reads them once the draft ends. **§6 is most of this already**; the recap is that view kept after the final pick. |
| Accessibility pass | Never audited. Worth doing before anyone drafts on something other than a laptop. |

---

## 9. From draft night 2026

The rehearsal and the live draft find what tests can't. **Append here the same
night or the next morning**, while it's still specific. For each one, write what
happened and what it would take to fix — not just "nomination was confusing." A
vague item here is an item nobody picks up.

### ✅ P0 — the draft stalled near the end with nobody on the clock — FIXED 2026-08-15

**What happened:** with roughly 7 picks still needed, the board showed nobody on
the clock and no one could nominate. Rosters were not full, so the draft could
not finish in the app.

**Root cause — confirmed, and it will happen again every year.**
[draft.ts:68](src/lib/draft.ts#L68) caps the search for the next nominator:

```js
const limit = n * rosterSize + n   // 10 * 16 + 10 = 170
for (let i = nominationIndex; i < limit; i++) { ... }
return null                        // "draft complete"
```

The draft needs **160** picks, so there are only **10 spare indices** — but
`nominationIndex` is not a pick counter. Every *skipped* seat consumes an index
too, because [draft-service.ts:203](src/server/draft-service.ts#L203) advances
it to the seat actually landed on:

```sql
UPDATE draft SET nomination_index = <landed index> + 1
```

Skipping costs almost nothing early and costs enormously at the end, which is
exactly where it bit. Once 9 of 10 managers are full, reaching the one manager
who still has slots can burn ~10 indices per single pick. The 10-index budget is
consumed by the *first* manager to fill up, long before the last one finishes.

**Reproduced** by running the committed `nominatorAt` against a simulated draft.
Nothing about the failure is exotic:

| Draft shape | Result |
|---|---|
| Nominator always wins their own lot (perfectly even) | completes, final index **160** |
| Emptiest roster wins each lot (mildly lumpy) | completes, final index **170** — *exactly at the cap* |
| Three managers buy heavily early (realistic) | **stalls at index 170 after 128 picks**, 32 short across 7 managers |

The even case only passes because it never skips anybody. Any real auction is
lumpy, and the mildly-lumpy case lands on 170 precisely — meaning **a single
`skipNominator()` would have stalled it too**, since that path bumps the index
with no pick behind it ([commish-service.ts:142](src/server/commish-service.ts#L142)).
This was not bad luck; the cap has no margin at all.

**FIXED** in `PROGRESS_LOG.md` step 18, exactly as specified below, with all four
suggested tests plus a `2n`-window test. Worth recording what the regression suite
showed when run against the *old* code: **the even and mildly-lumpy shapes still
pass**, and they are the two anybody would have written first. Only the realistic
skewed shape and the end-of-draft cases fail. That is why this shipped.

**The fix** — `nominatorAt` should stop guessing from an index bound and ask the
real question, "is anybody unfilled?":

1. Return `null` only when **every** manager is at `rosterSize`. That is the one
   true definition of a complete draft.
2. Otherwise scan forward from `nominationIndex` with no cap on the absolute
   index. Termination is guaranteed: someone is unfilled, and any window of
   `2n` consecutive indices visits every seat.

> ⚠️ Use `2n`, not `n`. A window of `n` consecutive indices straddling a snake
> turn can miss a seat — with `n=10` starting at index 9, the window covers
> slots 1–9 and never visits slot 0.

**Tests to add alongside it** (`src/lib/draft.test.ts` currently has no
end-of-draft coverage, which is why this shipped):

- a full 160-pick draft completes for even, lumpy, and skewed buy patterns
- `nominatorAt` never returns `null` while any manager is below `rosterSize`
- it returns `null` the moment the last slot fills
- a draft with several `skipNominator()` calls still completes

### ✅ P1 — "complete" and "stuck" are the same state on screen — FIXED 2026-08-15

The same `onTheClock: null` means both *the draft is finished* and *the app has
lost track of whose turn it is*. That's why the stall read as a freeze on the
night: there was nothing on screen to distinguish them, and no way to tell
whether to wait or intervene.

**FIXED**, mostly. `LotPanel` now renders three distinct states: a "Draft
Complete!" panel with pick count, total spend and links to the board and CSV; an
explicit **"Nobody on the clock — N slots still unfilled, this is a fault"**
warning; and the normal on-the-clock view, which now also carries a
"picks made / to go" counter.

Still open: **`draft.status` is not flipped to `'done'` automatically.** The panel
keys off "every roster is full" as well as the status, so it displays correctly
either way, but the database still only learns the draft ended when someone says
so by hand (or via `npm run draft:record`).

Two things follow, and they're worth doing even after the P0 fix:

- **Flip `draft.status` to `'done'` automatically** when every roster is full.
  Right now `setStatus` is only ever called by hand
  ([commish-service.ts:160](src/server/commish-service.ts#L160)), so the app
  never actually knows the draft ended.
- **Show remaining slots, and never render a bare empty clock.** If nobody is on
  the clock while slots remain, that is a bug and the board should say so —
  "12 slots unfilled, nobody on the clock" — rather than showing an empty state
  that looks deliberate. A visible "picks remaining: N" counter would have made
  this obvious within seconds instead of near the end of the night.

### 🟡 P2 — `voidLot` and `undoPick` decrement the index by exactly 1

**Still open** — this is now the top remaining item in this file.

Both do `nomination_index = GREATEST(0, nomination_index - 1)`, but nomination
may have advanced the index by more than 1 when it skipped full seats. The
decrement therefore lands mid-skip-run rather than back on the seat that
nominated. It self-heals — the next scan skips forward again — and it did not
cause the stall, but it means "undo" does not reliably hand the turn back to the
manager who just had it. Worth a test either way.
