# UAT — User Acceptance Testing

Run this on the **preview deployment**, on the device you'll actually use on draft night, with at least three browsers open side by side (one of them a phone). Multi-user behaviour has to be *seen*, not assumed.

Each section notes the requirement it proves.

**Any failure goes into `PROGRESS_LOG.md` with reproduction steps before it gets fixed.** A UAT failure is the highest-value learning in the project.

| Legend | |
|---|---|
| ⬜ | not tested |
| ✅ | pass |
| ❌ | fail — log it |

---

## A. Setup

| ✓ | Check | Notes |
|---|---|---|
| ⬜ | Sync players from Sleeper — pool loads, count sane, no duplicates | |
| ⬜ | Spot-check ~10 names/teams/positions against Sleeper | |
| ⬜ | Team defenses appear and are draftable | |
| ⬜ | Import a CSV instead — overrides pool and ordering | |
| ⬜ | All 10 manager names + display names correct | |
| ⬜ | **Randomize** draft order — result changes on re-roll | |
| ⬜ | Drag to reorder manually — sticks after refresh | |
| ⬜ | Round 1 / round 2 preview shows correct snake (forward, then reversed) | |
| ⬜ | Budget $200, roster 16, timer defaults editable and persist | |

## B. Access — *req 1*

| ✓ | Check | Notes |
|---|---|---|
| ⬜ | Phone, laptop, tablet all reach the draft at once | |
| ⬜ | Each manager claims their name and sets a PIN | |
| ⬜ | A claimed name can't be taken by someone else | |
| ⬜ | Wrong PIN rejected; correct PIN gets in | |
| ⬜ | Refresh mid-draft — still logged in, no state lost | |
| ⬜ | Close browser entirely and reopen — still logged in | |
| ⬜ | **All 10 managers connected at once**, all seeing the same state | |
| ⬜ | Kill wifi on one device 30s, reconnect — resyncs without refresh | |

## C. Nomination — *reqs 2, 7*

| ✓ | Check | Notes |
|---|---|---|
| ⬜ | Nominate button live only for the manager on the clock | |
| ⬜ | Everyone else sees whose turn it is | |
| ⬜ | **No countdown between lots** — walk away 5 min, nothing happens | |
| ⬜ | Nominator sets opening bid; rejected if above their max | |
| ⬜ | On nomination the player vanishes from the pool **on every screen** | |
| ⬜ | Player search and position filters work | |
| ⬜ | After a lot sells, next nominator is correct per the snake | |
| ⬜ | At a round turn, the order reverses correctly | |
| ⬜ | A manager at 16 players is skipped | |

## D. Bidding & the clock — *req 3*

| ✓ | Check | Notes |
|---|---|---|
| ⬜ | Clock starts at the configured time on nomination | |
| ⬜ | All screens show the same number, within ~1s | |
| ⬜ | **Set one device's clock 10 min fast, then join** — countdown still correct | |
| ⬜ | Leave a lot running with all browsers closed, then open one — settles immediately | |
| ⬜ | A bid above 10s remaining does **not** extend the clock | |
| ⬜ | A bid inside 10s remaining resets it to exactly 10s | |
| ⬜ | Repeated late bids keep resetting — a bidding war can't time out early | |
| ⬜ | `+$1`, `+$5`, custom amounts all work | |
| ⬜ | A bid at or below current bid is rejected | |
| ⬜ | Two people bidding the same instant → exactly one wins, no double-charge | |
| ⬜ | Commissioner changes timer mid-draft — applies to next lot | |
| ⬜ | Commissioner adds/removes 10s on the live clock | |
| ⬜ | Audio fires at 10s and 3s; gavel on sold | |

## E. Budget & max bid — *req 6*

| ✓ | Check | Notes |
|---|---|---|
| ⬜ | Everyone starts at $200 budget / **$185 max bid** | |
| ⬜ | Both update immediately after each win, on every screen | |
| ⬜ | Bidding over max is **blocked with a clear reason** (not a silent failure) | |
| ⬜ | Max bid falls correctly as roster fills — check the arithmetic by hand twice | |
| ⬜ | With 15 players and money left, full remaining budget can go on the last slot | |
| ⬜ | **No manager can reach a state where they can't afford their empty slots** | |
| ⬜ | A manager at 16 players can no longer bid | |

## F. Rosters — *reqs 4, 5*

| ✓ | Check | Notes |
|---|---|---|
| ⬜ | Winning a player adds them to that roster automatically, in draft order | |
| ⬜ | Price recorded correctly, no manual entry anywhere | |
| ⬜ | Position counts (QB/RB/WR/TE/DEF) accurate | |
| ⬜ | 16 players is a hard cap — a 17th is impossible | |
| ⬜ | Odd roster shapes allowed, not blocked | |

## F2. League board — the grid

| ✓ | Check | Notes |
|---|---|---|
| ⬜ | **League tab shows all 10 rosters at once**, 16 rows × 10 columns | |
| ⬜ | Rows read QB, RB, RB, WR, WR, WR, TE, FLEX, SUPERFLEX, DEFENSE, 6× BENCH | |
| ⬜ | Distinct color per manager; display names are the ones people use | |
| ⬜ | A sold player appears in the winner's column immediately, everywhere | |
| ⬜ | Auto-slotting sensible — extra RB → FLEX, 3rd QB → SUPERFLEX or bench | |
| ⬜ | Empty slots visibly empty, so you can see who's thin | |
| ⬜ | Drag your own player to another slot — sticks, survives refresh | |
| ⬜ | **Slotting never blocks a bid** — buy a 4th QB on purpose, bid goes through | |
| ⬜ | Slot labels stay pinned while scrolling sideways | |
| ⬜ | **On a phone:** grid usable, scrolls sideways, can jump to one manager | |
| ⬜ | Budgets tab matches the draft screen exactly | |
| ⬜ | Pick log matches what actually happened, in order | |

## G. Recovery — the ones that matter at 11pm

| ✓ | Check | Notes |
|---|---|---|
| ⬜ | Pause mid-lot — clock freezes everywhere; resume restores exact time | |
| ⬜ | Undo last pick — player returns to pool, budget refunded, order rewinds | |
| ⬜ | Edit a price after the fact — budget recalculates | |
| ⬜ | Reassign a player — both budgets correct | |
| ⬜ | Reopen a lot that sold by mistake | |
| ⬜ | Skip a nominator who stepped away | |
| ⬜ | Hard-refresh every device mid-lot at once — draft survives | |
| ⬜ | Export CSV — picks, prices, rosters correct and openable in Sheets | |

## H. Dress rehearsal — **Thursday 8/13, the real deadline**

| ✓ | Check | Notes |
|---|---|---|
| ⬜ | Ran 20–30 real picks with the actual league on the preview URL | |
| ⬜ | Nobody was confused about whose turn it was or the current bid | |
| ⬜ | Nothing needed manual correction | |
| ⬜ | It was faster than the spreadsheet | |
