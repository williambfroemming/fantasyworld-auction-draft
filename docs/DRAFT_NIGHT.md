# Draft night runbook

**App:** https://fantasyworld-auction-draft.vercel.app
**Commissioner:** Bill · **Rules:** $200 budget, 16 roster spots, opening max bid **$185**

**The bidding happens out loud, in the room. The app records the result.**
There is no timer and no countdown — nothing on screen is racing you.

Everything here is doable from the app. No terminal required.

---

## Before people arrive

- [ ] **Reset** if there was a rehearsal — `/setup` → **Reset draft**
- [ ] **Clear PINs** — `/setup` → **Clear all PINs** (everyone then sets their own)
- [ ] **Draw the order** — `/setup` → 🎲 **Randomize**, re-roll until the room's happy, then **Save order**
- [ ] Check the **Round 1 / Round 2 preview** matches what you announced
- [ ] Send the link round. Everyone picks their name and sets a 4-digit PIN
- [ ] **Start draft** (`/setup` → ▶ Start draft). Nobody can nominate until you do

> Sanity check: everyone should show **$200 / max $185** before the first nomination.

---

## How a player gets drafted

1. The manager on the clock picks a player from the pool and hits **Put up for auction**. Their name goes up on everyone's screen.
2. **The room bids out loud.** The app is not involved and nothing is counting down.
3. When the bidding stops, the **nominator** types the winning price and taps the winner. Hit **Sold**.
4. Roster, budget and max bid all update themselves, and the next manager is on the clock.

The order snakes: down the list, then back up it, repeating. A manager with 16 players is skipped automatically.

**Only the nominator (or the commissioner) can record the sale** — they ran the bidding, so they type the result.

### The price entry, and why it's laid out that way

Type the **price first**. Every manager who cannot afford it greys out immediately, so an
illegal price is refused while the room is still listening rather than after everyone
has moved on.

**Max bid** is `budget − (empty roster spots − 1)`, so everyone always keeps $1 per
unfilled slot. Recording a sale above it is blocked, the reason names the manager and
the number, and **the player stays on the block** — just call the correct number and
try again. Nothing is lost.

---

## Trades — players and auction dollars

**Trades → ** in the header, or ⚙ Commish → Trades. Any signed-in manager can record one.

Pick the two managers, tick the players each is giving up, add cash either way, and the
panel shows both managers' budget, roster count and max bid **after** the deal before you
commit it.

Two rules that surprise people:

- **A traded player's salary stays with whoever drafted them.** Receiving a $50 player
  costs you nothing; giving one away refunds you nothing. Only the cash moves money.
- **Giving a player away still opens a roster spot**, and every empty spot needs $1
  behind it. A manager who is nearly broke can be blocked from trading a player *out*
  even though no money leaves their side.

A trade is refused outright if either side would end up unable to fill their roster.
Refused means nothing is written — no half-done trades.

---

## When something goes wrong

All of this is under **⚙ Commish** (bottom right, commissioner only).

| Problem | Fix |
|---|---|
| Need a break | **Pause** — blocks nominations and sales. The player on the block stays up |
| Wrong player sold / wrong price | **Undo last pick** — refunds and returns them to the pool |
| Price typed wrong | **Edit the last pick** → set price |
| Player went to the wrong manager | **Edit the last pick** → reassign (moves the money too — this is a *correction*, not a trade) |
| Someone nominated by mistake | **Cancel current lot** |
| Someone's stepped away | **Skip nominator** |
| Forgot their PIN | **Seats** → click their name to clear it |
| Someone's screen looks stuck | Have them refresh — nothing is lost, all state is on the server |

> **Undo will refuse on a player who has been traded.** Reverse the trade first (record
> the opposite trade). Deleting a traded pick would leave both budgets quietly wrong.

**Nothing is stored on anyone's device.** Refreshing, closing the laptop, or dropping off
wifi loses nothing. There is no clock to fall out of sync with.

---

## After the draft

- [ ] **⚙ Commish → Download draft CSV** — pick #, nominator, player, team, position, owner, price
- [ ] Paste into the Google Sheet if you want the historical record in one place

---

## If the app fails completely

The Google Sheet still works. Export what's been drafted so far (CSV button above), paste
it in, and carry on the old way. Nothing about this replaces the sheet as a fallback.

---

## Notes for whoever maintains this

- Live database is `neondb`. Destructive test scripts run against `neondb_test` and refuse to start if pointed at the live one.
- `/test` (act as any manager) is **404 in production** and only exists locally with `ENABLE_TEST_SEATS=1`.
- `npm run db:verify` asserts $200/$185, the reserve invariant, and that trade adjustments sum to zero.
- Full detail in `PROJECT_PLAN.md`; the history of decisions and gotchas is in `PROGRESS_LOG.md`.
