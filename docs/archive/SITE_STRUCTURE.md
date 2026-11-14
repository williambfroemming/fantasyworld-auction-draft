# Site structure: top-bar modules

Status: **done** (2026-11-11, step 63 in `docs/PROJECT_PLAN.md` §13; see `docs/PROGRESS_LOG.md`).
Built on the `worktree-organize-ui` branch off `main`.

## Why

The top bar is three `<details>` menus in `src/components/SiteNav.tsx`:

- **Draft** — Draft Room, Board, Trades
- **Draft History** — Past Auctions, Spend & Value, Glossary
- **League History** — League Summary, Gazette, Records, Charts, Members, Players, Head to Head,
  Record by Week, Ask the Oracle, Glossary (10 items)

League History became a catch-all. The problems:

- The Gazette is buried in it, and it is the one thing members read every week.
- The Oracle is a destination page. You have to leave what you are reading to ask about it.
- The live draft is used one night a year but holds a top-level slot all year.
- The Glossary is listed twice.

The goal is a top bar where each item answers one question a member actually has, and the Oracle
can be reached from any page.

## Decisions (confirmed by the user, do not reopen)

1. The Oracle gets **both** a global "Ask" launcher (a slide-over panel) **and** its full page.
2. Draft and Draft History **merge** into one **Auction** menu with two labelled groups.
3. The Gazette and the Oracle move to **short URLs** (`/gazette`, `/oracle`), with **permanent
   redirects** from the old `/history/...` paths.

## Target top bar

```
FantasyWorld   The Gazette   History ▾   Auction ▾          [✦ Ask the Oracle]  [account ▾] [theme]
```

| Item | Kind | Contents |
|---|---|---|
| **FantasyWorld** (wordmark) | link `/` | Home, i.e. this season. Unchanged |
| **The Gazette** | direct link `/gazette` | Issue archive → `/gazette/[season]/[week]` |
| **History ▾** | menu | League Summary (`/history`) · Records · Members · Players · Head to Head · Record by Week · Charts |
| **Auction ▾** | menu with two groups | *This year:* Draft Room · Board · Trades. *Past auctions:* Archive (`/history/drafts`) · Spend & Value (`/stats`) |
| **Ask the Oracle** | button on the right | Opens a slide-over panel with `OracleBar`. Its footer links to the full page: "Open full page →" `/oracle` |
| Account menu | existing (`src/components/AccountMenu.tsx`) | Add **Glossary** here, as its only nav entry. Admin stays commissioner-only |

The top level stays at four stable items: the wordmark plus three. History drops from 10 items to 7,
all of them past seasons.

## Rules this work must not break (from `AGENTS.md`)

- **The Oracle stays out of the draft room.** The launcher must not render on `/draft`, `/board` or
  `/trades`. It must never touch `/api/state` or the fingerprint in `src/lib/version.ts`.
- **The whole site is behind the PIN.** The new routes (`/gazette/**`, `/oracle`) must **not** be
  added to the allow-list in `src/lib/gate.ts`. `src/lib/gate.test.ts` pins that list, so update its
  path fixtures and nothing else.
- **Do not enable `cacheComponents`** in `next.config.ts` while you are adding `redirects()`.
- **Next 16 is not the Next you know.** Read `node_modules/next/dist/docs/` for `redirects` and route
  moves before writing them.
- **Never run `npm run dev`** (it hits the live database). Use `npm run db:local:up` then
  `npm run dev:local`.

## Implementation

### 1. Nav model: `src/components/SiteNav.tsx`

- `Section` becomes `'gazette' | 'history' | 'auction'`.
- A `SECTIONS` entry is either a **direct link** (`{ key, label, href }`, rendered as a `<Link>` styled
  like a `<summary>`) or a **menu** (`{ key, label, groups: [{ label?, items }] }`, rendered as a
  `<details>`). Group labels are small caps headers inside the panel.
- Keep every behaviour the existing docblock defends:
  - `<details name="sitenav">` gives an exclusive accordion.
  - The component has no hooks, because it renders in both client and server pages.
  - `key` includes `current`, so navigating closes the menu.
  - The panel uses `static sm:relative` positioning, so it fits a 360px screen.
  - The first item of each menu is that section's home page.
- Rewrite the docblock's "three sections" rationale to explain the new shape and why. Delete the
  duplicate Glossary entries.
- Update the ~20 `<SiteNav section=…>` call sites (`grep -rn "<SiteNav" src`):
  `league-history` → `history`; `draft` and `draft-history` → `auction`; Gazette pages → `gazette`.
  `/glossary` takes no section, the same as `/`. The type checker will catch any you miss.
- `src/app/page.tsx` (~line 161) builds the front page's `Contents` from `SECTIONS`. Change it to
  flatten groups and include direct links.

### 2. Global Oracle launcher: new `src/components/OracleLauncher.tsx` (client component)

- Render it from `src/components/HeaderControls.tsx` and give `HeaderControls` a `hideOracle` prop.
  The draft pages (`src/app/draft/page.tsx`, `board`, `trades`) pass `hideOracle`. Use an explicit
  prop, not a pathname check.
- Clicking the button opens a right-side native `<dialog>` with `showModal()`, which provides the focus
  trap, Esc to close and the backdrop. Mount `<OracleBar />` **only while the dialog is open**: no
  fetch, effect or polling on page load.
- Do not add an extra request for sign-in or kill-switch state. `/api/ask` already refuses with 401
  (signed out) and 503 (Oracle switched off). Check how `src/components/OracleBar.tsx` displays those
  today. If either shows as a generic error, map it to a plain message: "Sign in to ask the Oracle" /
  "The Oracle is switched off right now."
- Turns live only while the panel is mounted and are lost on navigation. That matches the page, where
  each question already stands alone.
- On a phone the panel is full width, and from `sm` up it is about 28rem wide. Use the existing
  slate/amber tokens and the `font-display` header style.

### 3. Route moves and redirects

- Move `src/app/history/gazette/**` → `src/app/gazette/**`.
- Move `src/app/history/oracle/page.tsx` → `src/app/oracle/page.tsx`.
- Add `async redirects()` to `next.config.ts`, every one `permanent: true`:
  - `/history/gazette` → `/gazette`
  - `/history/gazette/:season/:week` → `/gazette/:season/:week`
  - `/history/oracle` → `/oracle`
  These keep links in emails that were already sent working.
- Update the hard-coded paths:
  - `scripts/history/notify-email.ts` (~line 110) builds the issue URL.
  - `src/components/landing/FrontPage.tsx` holds the Gazette teaser links.
  - `src/server/gazette-service.ts`: check for `revalidatePath` / links.
  - `src/lib/gate.test.ts` and `src/lib/gazette.test.ts` path fixtures.
  - Comments that cite `/history/gazette` in `src/db/schema.ts`, `scripts/history/gazette.ts` and
    `src/server/gazette-service.ts`.
  - Finish with `grep -rn -e "/history/gazette" -e "/history/oracle" src scripts docs`. Only redirect
    sources and archived docs should remain.
- `outputFileTracingIncludes` in `next.config.ts` traces `public/gazette/**` for `/` only. Today
  only the home page calls `issueArt`. If the moved issue page reads art, add its route to that map;
  if not, leave the map alone and say so in the log.

### 4. Docs

- `docs/PROGRESS_LOG.md`: a full entry with **Learned** and **Watch out for**.
- `docs/PROJECT_PLAN.md` §13: add and tick a box for this step.
- `AGENTS.md`: add one bullet saying the Oracle launcher is hidden on the draft pages and mounts
  `OracleBar` only when it is opened.
- At the top of this file, change the status to done.

## Suggested commits

1. Nav model and call sites
2. Route moves and redirects
3. Oracle launcher
4. Docs

## Verification

- `npm test`, `npx tsc --noEmit`, `npm run build`.
- `npm run db:local:up`, then `npm run dev:local`, then check:
  - [x] Every menu at 360px and on desktop: no overflow, navigating closes the menu, the current
        page is marked.
  - [x] "The Gazette" goes straight to `/gazette`, and an issue page highlights it.
  - [x] `/history/gazette/2025/7` returns 308 to `/gazette/2025/7`, and `/history/oracle` returns
        308 to `/oracle`.
  - [x] The Ask button opens the panel, a question returns an answer with its SQL, and Esc closes it.
  - [x] The Ask button is **absent** on `/draft`, `/board` and `/trades`.
  - [x] The Network tab shows no request caused by the launcher until it is opened.
  - [x] Signed out, `/gazette` and `/oracle` redirect to `/join?next=…`.
  - [x] With the Oracle switched off (Admin panel, which replaced `/setup`), the panel shows the "switched off" message.
  - [x] Glossary is reachable from the account menu.
