# Draft night runbook

**App:** https://fantasyworld-auction-draft.vercel.app
**Commissioner:** Bill · **Rules:** $200 budget, 16 roster spots, opening max bid **$185**

Everything here is doable from the app. No terminal required.

---

## Before people arrive

- [ ] **Reset** if there was a rehearsal — `/setup` → **Reset draft**
- [ ] **Clear PINs** — `/setup` → **Clear all PINs** (everyone then sets their own)
- [ ] **Draw the order** — `/setup` → 🎲 **Randomize**, re-roll until the room's happy, then **Save order**
- [ ] Check the **Round 1 / Round 2 preview** matches what you announced
- [ ] Confirm timer settings — default **25s** with a **10s** soft close
- [ ] Send the link round. Everyone picks their name and sets a 4-digit PIN
- [ ] **Start draft** (`/setup` → ▶ Start draft). Nobody can nominate until you do

> Sanity check: everyone should show **$200 / max $185** before the first nomination.

---

## How it runs

- The manager on the clock nominates a player and sets an opening bid; they're immediately the high bidder at that price
- **25 seconds** on the clock. Any bid inside the final **10 seconds** pushes it back to 10 — a bidding war cannot time out early
- When the clock hits zero the player is awarded automatically. Roster, budget and max bid all update themselves
- **No clock runs between picks.** Take as long as you like
- The order snakes: down the list, then back up it, repeating

**Max bid** is `budget − (empty roster spots − 1)`, so everyone always keeps $1 per unfilled slot. Bidding over it is blocked with the reason shown.

---

## When something goes wrong

All of this is under **⚙ Commish** (bottom right, commissioner only).

| Problem | Fix |
|---|---|
| Need a break mid-player | **Pause** — banks the exact time left; **Resume** restores it |
| Clock needs more/less time now | **−10s / +10s / +30s** |
| Picks are dragging | Change the **nomination timer**; applies to the next player |
| Wrong player sold / wrong price | **Undo last pick** — refunds and returns them to the pool |
| Price typed wrong | **Edit the last pick** → set price |
| Player went to the wrong manager | **Edit the last pick** → reassign |
| Someone nominated by mistake | **Cancel current lot** |
| Someone's stepped away | **Skip nominator** |
| Forgot their PIN | **Seats** → click their name to clear it |
| Someone's screen looks stuck | Have them refresh — nothing is lost, all state is on the server |

**Nothing is stored on anyone's device.** Refreshing, closing the laptop, or dropping off wifi loses nothing.

---

## After the draft

- [ ] **⚙ Commish → Download draft CSV** — pick #, nominator, player, team, position, winner, price
- [ ] Paste into the Google Sheet if you want the historical record in one place

---

## If the app fails completely

The Google Sheet still works. Export what's been drafted so far (CSV button above), paste it in, and carry on the old way. Nothing about this replaces the sheet as a fallback.

---

## Notes for whoever maintains this

- Live database is `neondb`. Destructive test scripts run against `neondb_test` and refuse to start if pointed at the live one.
- `/test` (act as any manager) is **404 in production** and only exists locally with `ENABLE_TEST_SEATS=1`.
- `npm run bots` simulates other bidders for solo testing — local only.
- Full detail in `PROJECT_PLAN.md`; the history of decisions and gotchas is in `PROGRESS_LOG.md`.
