# UAT — User Acceptance Testing

Run this on the **live deployment**, on the machine you'll use on draft night, with at least three browser sessions open side by side (use incognito / a second browser for separate cookie jars). Multi-user behaviour has to be *seen*, not assumed.

> The league confirmed everyone drafts on a laptop, so mobile layout is explicitly **out of scope**. If that changes, the grid and the winner buttons are the two things to re-check.

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
| ⬜ | Budget $200 and roster 16 are editable before the draft and persist | |

## B. Access — *req 1*

| ✓ | Check | Notes |
|---|---|---|
| ⬜ | Several laptops all reach the draft at once | |
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
| ⬜ | **Nothing is ever counting down** — walk away 5 min at any point, nothing changes | |
| ⬜ | Nominator sets opening bid; rejected if above their max | |
| ⬜ | On nomination the player vanishes from the pool **on every screen** | |
| ⬜ | Player search and position filters work | |
| ⬜ | After a lot sells, next nominator is correct per the snake | |
| ⬜ | At a round turn, the order reverses correctly | |
| ⬜ | A manager at 16 players is skipped | |

## D. Recording a sale — *req 3*

The bidding itself happens out loud. These check that the app records it correctly and
refuses anything illegal.

| ✓ | Check | Notes |
|---|---|---|
| ⬜ | A nominated player appears on every screen, with **no countdown anywhere** | |
| ⬜ | The nominator sees a price box and the ten managers; nobody else does | |
| ⬜ | The commissioner can also record a sale on someone else's lot | |
| ⬜ | Typing a price greys out every manager who cannot afford it, live | |
| ⬜ | **Set one device's clock 10 min fast** — nothing about the app misbehaves | |
| ⬜ | Leave a lot up for 20 minutes — it is still there, unchanged | |
| ⬜ | Recording a sale updates roster, budget and max bid on **every** screen | |
| ⬜ | Double-tap **Sold** on a laggy connection → exactly one pick, no double-charge | |
| ⬜ | A price over the winner's max is refused, **with the manager and number named** | |
| ⬜ | …and the player is **still on the block**, so the right number can just be typed | |
| ⬜ | $0 is refused — every player costs at least $1 | |
| ⬜ | Gavel sound on sold; nudge when it becomes your turn | |

## D2. Trades — *req 8*

| ✓ | Check | Notes |
|---|---|---|
| ⬜ | Trade a player one way: he moves rosters, **both budgets are unchanged** | |
| ⬜ | The giver's max bid *drops* (a slot opened) and the receiver's *rises* | |
| ⬜ | Trade cash only: budgets move by exactly that amount, both ways | |
| ⬜ | Players and cash both directions at once produces the right four numbers | |
| ⬜ | The preview panel matches what actually happens after committing | |
| ⬜ | A trade that would strand either side is refused **and writes nothing** | |
| ⬜ | Trading a player away when nearly broke is refused, with a readable reason | |
| ⬜ | A trade updates the League board and every other screen within a second | |
| ⬜ | The completed-trades log lists players, direction, and cash | |
| ⬜ | **Undo last pick** refuses on a traded player and says why | |
| ⬜ | After several trades, `npm run db:verify` still reports all checks passed | |

## E. Budget & max bid — *req 6*

| ✓ | Check | Notes |
|---|---|---|
| ⬜ | Everyone starts at $200 budget / **$185 max bid** | |
| ⬜ | Both update immediately after each win, on every screen | |
| ⬜ | Recording over max is **blocked with a clear reason** (not a silent failure) | |
| ⬜ | Max bid falls correctly as roster fills — check the arithmetic by hand twice | |
| ⬜ | With 15 players and money left, full remaining budget can go on the last slot | |
| ⬜ | **No manager can reach a state where they can't afford their empty slots** | |
| ⬜ | A manager at 16 players can no longer be sold anyone | |

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
| ⬜ | Grid readable on the smallest laptop in the room | |
| ⬜ | Budgets tab matches the draft screen exactly | |
| ⬜ | Pick log matches what actually happened, in order | |

## G. Recovery — the ones that matter at 11pm

| ✓ | Check | Notes |
|---|---|---|
| ⬜ | Pause mid-lot — nominations and sales are blocked; the player stays on the block; resume restores both | |
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

## I. The FantasyWorld Gazette — read one before the league does

The grounding check proves every figure is real. It says nothing about whether
the writing is any good, or whether a joke lands badly on someone. That part is
a person's job, and it is the reason the archive is committed as a reviewable
diff rather than written straight to the database.

| ✓ | Check | Notes |
|---|---|---|
| ⬜ | `/history/gazette` renders the latest issue in full, with back issues grouped by season below | |
| ⬜ | Masthead reads as a newspaper — rules top and bottom, dateline between, serif headline | |
| ⬜ | The column sets in justified columns with a drop cap; nothing splits awkwardly across a break | |
| ⬜ | Readable in **both** themes, and on the smallest laptop in the room | |
| ⬜ | Standings and Power Rankings disagree, and the movement arrows make sense against last week | |
| ⬜ | The Ledger shows dollars for 2024+ and counts only for earlier seasons — `—` never reads as $0 | |
| ⬜ | The Belt changed hands across the season and its history is right | |
| ⬜ | A career milestone claim names the years it is true across, not "of all time" over six seasons | |
| ⬜ | Pick three issues at random: **every number in the prose is real** and attributed to the right manager | |
| ⬜ | An issue reads like it remembers last week — a callback, a running bit, a settled prediction | |
| ⬜ | `npm run gazette -- --audit` passes over the whole committed archive | |
| ⬜ | **Read every issue before the league sees it.** Mean is the point; cruel about the wrong thing is not | |
| ⬜ | Nothing references a day of the week, a kickoff time, or "came down to the last game" — none of that is knowable | |
| ⬜ | The Tuesday cron ran on `workflow_dispatch` and committed both the Sleeper snapshot and the issue | |
