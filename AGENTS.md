<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Fantasy Auction Draft

Live auction draft app for a 10-person fantasy football league, replacing a manual Google Sheet.
**The 2026 draft was held Friday 2026-08-14 and is complete — 160 picks, all rosters full.** It is
now an archive the league can browse, and the app keeps every season from here on. This is not a
toy: ten people bid real budgets in a room, in real time.

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
- **Every read of `picks` or `lots` is filtered by season.** They hold every draft the league has ever run, ~160 rows a year, forever. `manager_totals` carries the filter for budgets; miss it and each manager starts the new season carrying their whole previous spend — all ten deeply negative, silently, because budgets are derived. Miss it in the pool exclusion and last year's players are undraftable, turning a redraft league into a keeper league. Read `draft.season`; never hardcode a year outside `scripts/migrate-seasons.ts`.
- **A pick stores its own `player_name` / `player_team` / `player_position`.** The pool is re-imported every season, so joining an archived pick to `players` shows a future team on a past board. The live draft may join; the archive never does.
- **`npm run draft:reset` is not how a new season starts.** It erases the current season. Use `npm run season:new -- <year>`, which deletes nothing and moves the finished draft into the archive.
- **Every mutation is ONE SQL statement, not `SELECT … FOR UPDATE`.** Neon's HTTP driver has no interactive transactions; the transactional version fails at runtime. Awards and trades use data-modifying CTEs so they cannot half-apply.
- **A traded player's salary stays with whoever drafted them.** A trade moves `picks.manager_id`, which would drag the charge along too, so it books an equal-and-opposite pair of `budget_adjustments` to cancel that out. Every trade's adjustments sum to zero — `npm run db:verify` asserts it.
- **`GET /api/state` must stay uncached** — `export const dynamic = 'force-dynamic'` *and* an explicit `Cache-Control: no-store` header. It no longer has side effects, but a cached 204 still strands every client on a stale board and looks like a UI bug.
- **Do not enable `cacheComponents`** in `next.config.ts`. Next 16 *removes* the `dynamic` route-segment config when it's on, which would silently break the rule above. We are deliberately on the "previous caching model."
- **A trade must bump `draft.rev`.** It changes no pick *count*, so it is invisible to the polling fingerprint otherwise. See `src/lib/version.ts`.
- **`autoSlot()` is display-only** and must stay unreachable from any award path. Position slotting must never block a sale. Its `overflow` must always be **drawn**, not ignored: a manager who skips the DEFENSE slot has a 16th player with nowhere to sit, and the board grows a bench row for them (`slotRows`). Two managers had an invisible player on the 2026 board because the callers dropped `overflow`.
- **The player queue is private and stays off the polling path.** It must never enter `/api/state` or the fingerprint in `src/lib/version.ts` — a league-wide payload would leak everyone's targets, and widening the fingerprint would make every client's 204 depend on one person's private edit. `/api/queue` takes the manager id from the session cookie and has no id field to send. There are integration tests for both properties.
- **`nominatorAt` has no index cap.** It returns null only when every roster is full. The old `n * rosterSize + n` bound stalled the live 2026 draft with 32 picks left, because a skipped seat consumes an index with no pick behind it. Scan a `2n` window, never `n`.
- **Positional stats group on `players.position`, never the display slot.** A WR shown in FLEX is still a WR, and `positionMarket` excludes K and DEF on purpose (but `SPEND_COLUMNS` keeps them in an OTHER bucket, because a budget row that doesn't total what someone spent is a lie).
- **`nomination_index` is a cursor, not a seat.** `nominatorAt` scans *forward* from it, so the seat it lands on can be several indices later when full rosters are skipped — which means arithmetic on the cursor (`- 1` to undo, `+ 1` to skip) does not do what it reads like. Void and undo restore `lots.nomination_index`; skip advances past `onTheClock.index`. Three functions had this bug; a single nominate-then-void passes either way, so test across a skip run.
- **"Is this guy hurt" is a stored column, not a fetch.** `players.injury_status` and friends come from the same 5MB Sleeper dump the pool already uses, refreshed out-of-band by `npm run news:refresh` — so on draft night the answer is in Postgres and no provider being down can take it away. It is a **snapshot**: `injury_updated_at` is what lets the UI say "as of" rather than imply live. **A null status means UNKNOWN, never healthy**: a pool that has never been refreshed has null on every row, and painting those as fit is a confident wrong answer about the exact thing being asked. `InjuryBadge` renders nothing rather than a green tick.
- **There is no live news feed, and that is a decision rather than a gap.** One was built and removed the same day: a headline panel is only as fresh as the last refresh, Sleeper already does it better and is a tab away, and an app that shows stale news invites people to trust it at the exact moment they should not. Injury *status* is different — small, factual, and attached to a price you are about to pay. If you are about to add a feed back, read `docs/BACKLOG.md` §1 first.
- **Nothing on the polling path makes an outbound call.** `/api/state` is polled by every client several times a second, so a third party in front of it could stall an award. `sleeper.test.ts` has structural tests asserting `draft-service.ts` neither calls `fetch(` nor imports the Sleeper client. Availability reaches the open lot as a stored column on a join that already existed.
- **`sleeper_id` is the only player key that survives a season.** `players.id` is a CSV slug or a Sleeper id and the pool is re-imported yearly, so it dies every August; `resolveSleeperIds` pins a stable one at import and `awardLot` snapshots it onto the pick. It is **nullable on purpose** — the matcher refuses to guess between two same-named players, because a wrong match silently moves one player's price history onto another. Treat null as "unknown", never as an error, and never put it on the draft path.
- **`picks` snapshots `player_rank` as well as name/team/position.** Rank is otherwise recoverable only by joining `players`, and that join dies the moment the next season's CSV replaces the pool. Read it from `pk.`, never the joined `p.` — one source of truth, so live and archive cannot disagree.
- **Money questions attribute to the drafter, via `draftersByPick()`.** A trade moves `picks.manager_id` but not the salary, and `budget_adjustments` can't recover the original buyer because a trade folds salary and cash into one row. The trade log is the only surviving source.
- **The value view compares within a position, never across.** A cross-position comparison doesn't measure value, it just rediscovers that this is a superflex league — every top "overpay" comes out a QB. There's a unit test that fails if this is "simplified". This is the most-repeated mistake in the codebase: it was written *again* in the Gazette's season preview, whose first cut returned Mahomes, Nix, Purdy, Dart, Prescott and Lawrence as the six biggest reaches of the auction. The cross-position version is the one that falls out of the data naturally, so the rule needs a test at every site, not a comment. **Both ends are degenerate**, too — an unfiltered within-position delta fills with $1 tail players, so a bargain must be somebody the board actually rated and a reach must have real money on it.
- **Roster is 16 slots.** `maxBid = budget − (16 − rostered − 1)` → $185 at the start. Getting this wrong skews every bid all draft.
- **No backticks inside the SQL template literals.** They terminate the tagged template and the error surfaces as an unrelated esbuild parse failure.
- **The Gazette has a reporter, and `threads` is his notebook.** Gordon Applewhite has covered this league since a season he no longer discusses; the persona lives entirely in `scripts/history/gazette-prompt.ts`. Each issue emits an updated notebook of `bit` / `thesis` / `callback` / `arc` entries and the next week's prompt receives it, which is how a running joke gets crueller and a thesis gets revised instead of restated. **Do not add a second notebook** — a markdown file or a hand-maintained log would fork the state, and the version in the database is the one the prompt actually reads and the one committed to `data/history/gazette/`.
- **A Gazette issue renders from its own stored `facts`, never from a live query.** The refresh moved to **Tuesday** so the newsletter lands while the week is still worth talking about — which means it is written while stat corrections are still settling, and the importer rewrites the season wholesale every run. Snapshotting the pack is what makes that safe: the prose and the tables beside it are provably consistent with what was known at press time, and a Thursday correction becomes next week's joke instead of this week's contradiction. Re-deriving the tables at request time would undo the entire argument. The history pages self-heal on the next import; an issue does not, and must not.
- **Nothing in the Gazette may know about a game played after the week it covers.** Every derivation filters to `season < S || (season === S && week <= W)` first. Three specific traps: `season_standings` is season-grain and rewritten wholesale, so it holds the **final** table — a backfilled week 7 issue reading it prints an 11-3 record for a team that was 4-3. `player_seasons.avg_points` is likewise the final average, so judging a week-7 boom against it grades the player on games they hadn't played. And `records()` / `allPlay()` / `headToHead()` take matchups directly, so they are only as honest as what you hand them. The one sanctioned exception is career totals in Milestone Watch, which read standings for **completed earlier seasons only** — that table is the only place wins and points exist before 2020.
- **The grounding check is the publish gate, not a lint.** `ungroundedNumbers()` compares every digit in the prose against a generic walk of the fact pack. It runs three times: in the script before any write (with one retry that names the offending figures back to the model), in `npm run gazette -- --audit`, and as a **vitest test over the committed archive** — which is only possible because the pack is snapshotted, and which is what stops a hallucinated score reaching `main`. The prompt rule that makes it sharp is *counts are written as words*: with "ten teams" spelled out, a bare digit not in the pack is unambiguously an invention rather than prose.
- **The Ledger reports counts, and dollars only where a rate is on record.** `highLowWeeks()` deliberately carries no money — see its docblock. `seasons.side_bet` was added for the years the league actually ran the $10 bet (2024 onward); **null is unknown, never "no bet"**, so a backfilled 2020 issue says nothing about money rather than claiming everyone broke even.
- **Gazette art never depicts a person, and is never generated on a request path.** `npm run gazette:art` hands the finished issue back to the model that wrote it and asks it to art direct — there is no house style, because the article dictates the art. Two rules are load-bearing. **No identifiable people, no portraits, no real team marks**: this paper writes about ten real, named men, and a generated photograph of one of them is a fabricated picture of somebody who exists, published under their name; the prompt reaches for objects, weather and aftermath instead. And the image is made **once**, written to `public/gazette/{season}-{week}.*`, and read off disk by `src/server/gazette-art.ts` — same rule that keeps Sleeper off `/api/state` and that got the news feed deleted. Null art is the normal case, not an error: every issue written before this existed has none, and the front page simply runs the headline without a picture.
- **The season preview is week zero, and it is a different paper.** One edition a year has no games behind it: the one filed after the auction. It shares the table, the mirror, the notebook and the grounding gate with a week edition, and shares **no figures at all** — so it has its own pack (`seasonPreview()`), its own prompt (`gazette-preview-prompt.ts`, versioned from 101 so a stored `prompt_version` names the file that wrote it) and its own furniture. `isPreview()` discriminates on `kind === 'preview'` and **never** on `kind === 'week'`: `kind` is absent from every issue written before the preview existed, so the negative test is the only one that reads the back catalogue correctly. Its notebook comes from the last issue of the *previous* season — `getPriorIssues()` is same-season by design, which would open every new year with an empty notebook.
- **`season_standings.place` is the REGULAR SEASON, not the bracket.** Jack placed first in 2025; Gabes won it. Anything that prints `place` under a heading like "how the season finished" puts first place beside the wrong man, and the prose beside it repeats the error. The preview pack names these `regularSeasonPlace` / `bestRegularSeasonPlace` / `lastRegularSeasonPlace` and carries a separate `finish` field for the bracket, because the model reads field names.
- **A stat that isn't surprising doesn't get printed.** Candidates below `MIN_SURPRISE` are dropped before the model ever sees them, and a rank is only stated when the rank is short. "Only 316 losing scores on record beat it" is technically true, structurally identical to a real record, and completely meaningless — and printing one every week is what teaches a reader that this section's superlatives mean nothing.
- **Never develop against the Neon database.** `npm run dev` against Neon exhausted the project's data-transfer quota in four days and took the *live* database down — because `/api/state` polls every 400ms and `getState()` runs five queries per poll, so one open tab is ~1.08M queries a day. Use `npm run dev:local` (Docker Postgres 17 behind a Neon HTTP proxy; `npm run db:local:up` first). `src/db/neon-local.ts` redirects the driver **by host**, so the same code path talks to Neon in production without a flag to forget. The driver, protocol and tagged-template semantics are identical — only the endpoint moves, deliberately, because the award and trade statements are single data-modifying CTEs and a `pg` shim would sit between them and the database in dev but not in prod.

## Commands

**Live:** https://fantasyworld-auction-draft.vercel.app · **Live DB:** `neondb` · **Test DB:** `neondb_test`

### Local development — do this, not `npm run dev`

```bash
npm run db:local:up          # Docker: Postgres 17 + two Neon HTTP proxies (4444 live, 4445 test)
npm run db:local:setup       # build the schema from src/db/schema.ts (drops and recreates)
npm run db:local:seed -- <rankings.csv>
npm run dev:local            # next dev against local Postgres

npm run local -- <any command>   # run anything with the local DATABASE_URL/TEST_DATABASE_URL
npm run local -- npm run db:verify
npm run local -- npm run test:int
npm run db:local:setup-test  # same, for neondb_test
npm run db:local:down        # stop (keeps data) · db:local:reset throws the volume away
```

`npm run local` works by exporting the URLs before the inner command; `dotenv` does not
override an already-exported variable, so every existing script goes local unchanged.

```bash
npm run dev              # ⚠️ local dev against the LIVE database — see the non-negotiable above
npm run dev:test         # local dev against the TEST database, /test console enabled
npm test                 # unit tests for the rules engine (vitest)
npm run db:push          # migrations + re-applies the manager_totals view
npm run db:verify        # $200/$185, the reserve invariant, and zero-sum trade adjustments
npm run test:int         # integration tests -- runs against neondb_test only
npm run db:backup        # full JSON snapshot of every table -> backups/
npm run season:list      # what drafts are on record, and which is current
npm run season:new -- 2027   # archive this season, start the next. DELETES NOTHING
npm run draft:reset      # erase THIS season back to setup (not how you start a new year)
npm run draft:record -- "Mario|Aaron Rodgers|1"   # record a sale outside the nomination order
npm run db:migrate-seasons        # the one-draft -> season-per-year migration (live)
npm run db:migrate-seasons -- --test
npm run db:migrate-queue          # adds the private player_queue table
npm run db:migrate-queue -- --test
npm run db:migrate-pick-ranks     # snapshots pool rank onto picks. RE-RUN AFTER EVERY DRAFT,
                                  # BEFORE the next season's rankings CSV is imported
npm run db:migrate-lot-index      # adds lots.nomination_index (no backfill -- see the script)
npm run db:migrate-identity       # players.sleeper_id + picks.player_sleeper_id, resolved
                                  # against Sleeper. RE-RUN AFTER EVERY POOL IMPORT
npm run db:migrate-identity -- --offline   # columns only, no network
npm run news:refresh              # player availability from Sleeper. RUN THE WEEK OF THE DRAFT
npm run pins -- --clear
npm run season:info                   # prize money and draft location, per season
npm run season:info -- 2026 --city "San Diego" --state CA
npm run season:info -- 2026 --champion 2100 --runner-up 600 --third 300
npm run season:info -- 2025 --side-bet 10          # low scorer pays high scorer

### The FantasyWorld Gazette — the weekly newsletter
npm run db:migrate-gazette                # the week_issues table + seasons.side_bet
npm run gazette                           # newest unwritten week of this season
npm run gazette -- 2025 7 --facts         # print the pack, call nothing
npm run gazette -- --sample 2025 6 3      # 3 CONSECUTIVE weeks, dry-run, for tuning the voice
npm run gazette -- 2025 7 --replay        # re-prompt from the STORED pack — prose diff only
npm run gazette -- --backfill 2025        # a season, strictly chronological
npm run gazette -- --seed                 # load the committed issues, no API key
npm run gazette -- --audit                # re-check every committed issue's grounding
npm run gazette -- --preview 2026         # the SEASON PREVIEW, written from the auction
npm run gazette -- --preview 2026 --facts # its pack, call nothing
npm run gazette:art -- 2025 14            # art for one issue, from the issue itself
npm run gazette:art -- --all              # backfill every issue that has none
npm run gazette:art -- 2025 14 --dry-run  # write the art direction, generate nothing
npm run gazette:art -- --models           # image models this gateway will actually serve
```

> Issues are **ordered**, not independent: each reads the previous one's threads,
> belt holder and used stat ids. So a backfill runs chronologically within a
> season and never in parallel, and `--regenerate` on a mid-season week orphans
> every later issue unless you pass `--forward`.
>
> `--sample` is always a dry run and threads its issues in memory, which is the
> only way a sample can show whether week two picks up what week one put down.
>
> Bump `PROMPT_VERSION` in `scripts/history/gazette-prompt.ts` on **every** prompt
> edit — it is stored per issue, so "which voice wrote this" stays answerable.
> That file must contain exactly two backticks; a structural test enforces it,
> because an inline backtick has terminated a prompt template here twice.

> `drizzle-kit push` silently DROPS the `manager_totals` view, which 500s
> `/api/state`. Always use `npm run db:push`, which re-applies it.
>
> **`drizzle-kit push` cannot tell a new table from a rename** and stops to ask
> interactively — which fails outright in a non-TTY. Structural changes go in a
> hand-written, idempotent script instead: see `scripts/migrate-seasons.ts`.
>
> **`scripts/migrate-called-auction.ts` is superseded and refuses to run** once
> `draft.season` exists. It ends by rebuilding `manager_totals` from a copy frozen
> before seasons, so running it now would silently strip the season filter and
> bankrupt every manager. A migration that hardcodes a view definition ages into a
> loaded gun; guard it rather than trusting the order it gets run in.
>
> An env-var prefix does not survive `&&`: `VAR=x a && b` sets VAR for `a` only.
> Use `export VAR; a && b` in any chain that redirects the database URL.
>
> **Next 16 refuses to start a second `next dev` in the same directory.** To smoke-test
> against the test DB you must stop the live-DB server first, or you will drive HTTP
> requests at one database while wiping another.
