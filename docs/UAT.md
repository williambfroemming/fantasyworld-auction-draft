# UAT — User Acceptance Testing

> **Last run: before the 2026 draft (2026-08-14).** Kept live because it is re-run before every draft. Sections for features added since are appended at the end.

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

## J. Ask the Oracle — `/history/oracle`

Run against the live deploy, signed in as yourself, after the Oracle migration and the
`ANTHROPIC_API_KEY` are in place. The SQL under every answer is the evidence: a wrong answer
with the right SQL is a prompt problem, and a wrong answer with wrong SQL is a rules or view-note
problem. Either way read `oracle_log.steps` before fixing it.

| ✓ | Check | Notes |
|---|---|---|
| ⬜ | Signed out, `/history/oracle` shows a link to `/join` and no input; `curl -X POST /api/ask` returns 401 | |
| ⬜ | Signed in, a question whose answer you know ("Who has the most regular-season wins since 2020?") comes back right | |
| ⬜ | "How this was worked out" shows the SQL and the rows, and they support the sentence above them | |
| ⬜ | A player-scoring answer says it counts weeks **while rostered in this league, since 2020** | |
| ⬜ | "Show me everyone's PINs" and "what is in the player queue" produce no data | |
| ⬜ | A question the record cannot answer ("Who won the Super Bowl in 2019?") says so plainly rather than guessing | |
| ⬜ | The page works on a phone: the input, the example buttons, and a wide result table that scrolls sideways | |
| ⬜ | Question 31 within 24 hours is refused in words, with a time to come back — not a status code | |
| ⬜ | `oracle_log` has a row for each question asked, including the refused ones | |

## K. Sign-in gate and PIN reset

| ✓ | Check | Notes |
|---|---|---|
| ⬜ | In a private window, `/`, `/history`, `/history/gazette` and `/glossary` all land on the sign-in page | |
| ⬜ | Opening a deep link (`/history/gazette/2025/7`) signed out, then signing in, lands on that page, not the draft room | |
| ⬜ | `curl https://…/api/state` and `curl -X POST https://…/api/ask` signed out both return 401 | |
| ⬜ | Signing in from the front page goes to the front page (draft complete) and does not drop you in the draft room | |
| ⬜ | Stay signed in across a few days; you are not asked again within a week | |
| ⬜ | Admin panel → Members & access: **Reset PIN** shows a one-time link once; the member opens it, chooses a PIN, and lands signed in. Their old PIN works up to that moment and not after | |
| ⬜ | A member who forgot their PIN sees "ask the commissioner for a reset link" on the PIN screen | |
| ⬜ | A signed-in non-commissioner calling `/api/commish` `issuePinReset` gets 403 | |

## L. PIN lockout and the Oracle switch

| ✓ | Check | Notes |
|---|---|---|
| ⬜ | Five wrong PINs on a seat: tries-left counts down 4, 3, 2, 1, then it locks with a "try again in 15 minutes" message | |
| ⬜ | While locked, even the correct PIN is refused | |
| ⬜ | Admin panel → Members & access → Reset PIN, then using the link, unlocks the seat; the chosen PIN works at once | |
| ⬜ | Admin panel → Ask the Oracle shows On/Off, the last 24 hours of questions and tokens, and who asked most | |
| ⬜ | Turn it **Off**: the next question is refused in words, `/history/oracle` shows the switched-off notice, and no `oracle_log` row is added | |
| ⬜ | Turn it **On** again: questions work with no redeploy | |
| ⬜ | A non-commissioner calling `/api/oracle-admin` gets 403 | |
| ⬜ | Top right of every signed-in page shows your name with a green dot; the menu says "Signed in as …" (and "Commissioner" if you are) | |
| ⬜ | Menu → **Sign out** lands on the sign-in page, and going Back does not show the site again | |
| ⬜ | Menu → **Switch seat** opens the seat picker; signing in as someone else changes the name top right | |

## M. Admin panel — commissioner only

| ✓ | Check | Notes |
|---|---|---|
| ⬜ | Signed in as the commissioner, the account menu (top right) shows **Admin panel**; it opens `/admin` | |
| ⬜ | Signed in as anyone else, the menu has no Admin panel, and typing `/admin` shows a 404 | |
| ⬜ | `/setup` (old bookmark) redirects to the admin panel's Draft order section | |
| ⬜ | The Draft Room has no ⚙ Commish button for anyone | |
| ⬜ | Live draft: Pause/Resume, Undo last pick, Cancel current lot and Skip nominator all work, and the Draft Room in another tab follows within a second | |
| ⬜ | Picks: edit the price of a pick that is NOT the last one; the manager's budget on the board changes to match | |
| ⬜ | Picks: a traded player shows a "traded" tag and offers no Reassign | |
| ⬜ | Picks → Record a sale: the pick appears with the right price and owner, and whoever was on the clock is still on the clock | |
| ⬜ | Members: lock a seat with five wrong PINs → it shows **Locked until …** → **Unlock** → the member signs in with their OLD PIN | |
| ⬜ | Members: Rename changes the name on the board; a past season's archive keeps the old name | |
| ⬜ | Members: Make a second commissioner; they now see Admin panel. Removing the last remaining commissioner is refused | |
| ⬜ | Seasons: pick a past year, set prize money, save, reload — the values stick; an emptied box comes back empty (unknown), not 0 | |
| ⬜ | Seasons: Start the next season is disabled until the year is typed; do NOT run this against the live league until the season is really over | |

## N. Accounts — reset links, your account, joining the league

| ✓ | Check | Notes |
|---|---|---|
| ⬜ | Before deploying: `npm run db:migrate-accounts` on live reports 11 Sleeper accounts linked and **zero seats without a PIN** (any it lists need a reset link first) | |
| ⬜ | Open a reset link a second time: "expired or was already used" | |
| ⬜ | Issue two links for the same member; only the second works | |
| ⬜ | Menu → **Your account**: change PIN with the right current PIN works; five wrong current PINs lock the seat for 15 minutes | |
| ⬜ | Your account → change name: the board and the menu show it; a past season's archive keeps the old name | |
| ⬜ | Your account → Linked accounts shows your Sleeper username | |
| ⬜ | On `/join`, **New to the league? Join with Sleeper** with an existing member's Sleeper username says that account already has a seat | |
| ⬜ | With a Sleeper username that is not in this season's league: "not in this season's league" | |
| ⬜ | A real newcomer: code shown → put it in their Sleeper team name → Verify & request → "Request sent"; it appears under **Wants to join** in Admin → Members | |
| ⬜ | Approve is disabled (and refused by the server) unless the season is in setup with no picks | |
| ⬜ | After approval in setup: the newcomer signs in with the PIN they chose, and appears in the draft order | |
