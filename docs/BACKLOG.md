# Backlog — 2027 season and beyond

> **Nothing in this file is for draft night.** This is the parking lot for ideas
> that arrive mid-build and mid-draft, so they don't turn into a risky change on
> a deadline. Read `PROJECT_PLAN.md` for the durable spec first — the
> non-negotiables in §4 constrain most of what's below.

Add to this freely. An item here costs nothing; the same item attempted in
August costs the draft.

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

1. **News never touches `/api/state`.** That route is polled every 400ms by 10
   clients, is `force-dynamic` + `no-store`, and settles lots as a side effect.
   Adding a third-party fetch to it puts someone else's uptime on the critical
   path of every bid. News gets its own route.
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

## 2. Also raised, not yet specified

| Item | Note |
|---|---|
| Mobile / tablet layout | Explicitly out of scope for 2026 (`UAT.md`) because everyone drafts on a laptop. If that changes, the League grid and the bid buttons are the two things to re-check. |
| Keepers | The league doesn't currently run them. Would need pre-loaded picks at a fixed price and a starting budget adjusted per manager — both fit the derived-budget model without schema surgery. |
| Post-draft roster export to Sleeper | Today the draft ends at a CSV (`/api/export`). Pushing results into Sleeper directly would need league write auth, which is a much bigger ask than the read-only pool sync. |
| Draft recap page | The `bids` audit trail is already captured and never read. Bidding wars, biggest overpays, who drove prices up — all derivable from data we keep and throw away. |
| Sound / accessibility pass | Audio cues are currently the only signal for some state changes. |

---

## 3. From draft night 2026 — fill this in

The rehearsal and the live draft find what tests can't. **Append here the same
night or the next morning**, while it's still specific:

- _(nothing yet)_

For each one, write what happened and what it would take to fix — not just
"nomination was confusing." A vague item here is an item nobody picks up.
