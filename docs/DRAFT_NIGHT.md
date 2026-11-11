# Draft night runbook

> **Last run: the 2026 draft, Friday 2026-08-14.** Kept live because it is reused every August — re-read and update it before the 2027 draft.

**App:** https://fantasyworld-auction-draft.vercel.app
**Commissioner:** Bill · **Rules:** $200 budget, 16 roster spots, opening max bid **$185**

**The bidding happens out loud, in the room. The app records the result.**
There is no timer and no countdown — nothing on screen is racing you.

Everything here is doable from the app. No terminal required.

---

## Before people arrive

Everything for the commissioner lives on one page: **your name (top right) → Admin panel**.
Only commissioners see that menu item; anyone else who types `/admin` gets a 404.

- [ ] **Reset** if there was a rehearsal — Admin panel → Export & reset → **Erase {year} draft**
- [ ] PINs set during a rehearsal can stay — they are the members' own. If someone needs a
      fresh one: Members & access → **Reset PIN** (shown once; tell them). There is no
      "clear PIN" button any more: a cleared seat can be claimed by anyone who reaches the
      public sign-in screen first
- [ ] **Draw the order** — Admin panel → Draft order → 🎲 **Randomize**, re-roll until the room's happy, then **Save order**
- [ ] Check the **Round 1 / Round 2 preview** matches what you announced
- [ ] Send the link round. Everyone picks their name and sets a 4-digit PIN
- [ ] **Start draft** (Admin panel → Live draft → ▶ Start draft). Nobody can nominate until you do

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

**Draft → Trades** in the header, or Admin panel → Export & reset → Trades. Any signed-in manager can record one.

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

All of this is in the **Admin panel** (your name, top right → Admin panel). The page opens
on **Live draft**, and it polls like the Draft Room, so it is safe to keep open in a second
tab all night. There is no ⚙ Commish button in the Draft Room any more.

| Problem | Fix |
|---|---|
| Need a break | Live draft → **Pause** — blocks nominations and sales. The player on the block stays up |
| Wrong player sold | Live draft → **Undo last pick** — refunds and returns them to the pool |
| Price typed wrong (any pick, not just the last) | Picks → find it → **Edit** → set price |
| Player went to the wrong manager | Picks → **Edit** → reassign (moves the money too — this is a *correction*, not a trade; not offered on a traded player) |
| Bought in the room but can't be entered | Picks → **Record a sale** — skips whose turn it is, still enforces max bid |
| Someone nominated by mistake | Live draft → **Cancel current lot** |
| Someone's stepped away | Live draft → **Skip nominator** |
| Seat in the wrong place after picks | Draft order → **swap two seats** |
| Forgot their PIN | Members & access → **Reset PIN** — tell them the new one |
| Locked out after five wrong PINs | Members & access → **Unlock** — their own PIN works again |
| Someone's screen looks stuck | Have them refresh — nothing is lost, all state is on the server |

> **Undo will refuse on a player who has been traded.** Reverse the trade first (record
> the opposite trade). Deleting a traded pick would leave both budgets quietly wrong.

**Nothing is stored on anyone's device.** Refreshing, closing the laptop, or dropping off
wifi loses nothing. There is no clock to fall out of sync with.

---

## After the draft

- [ ] **Admin panel → Export & reset → Download draft CSV** — pick #, nominator, player, team, position, owner, price
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
