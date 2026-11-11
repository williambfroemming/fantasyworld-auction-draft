# Activity roadmap — feature J, steps 63–66

The commissioner wants to know which pages the league actually uses, who uses them, and for
how long. This is **first-party** tracking we built ourselves: no analytics SDK, no
third-party script, no Vercel Analytics. The data is **commissioner-only**. It shows in
Admin panel → Activity, members never see it, and the Oracle never gets a view of it.

**Status: built, all four steps, 2026-11-11.** This file is now the record of the decisions.
Read it before changing anything that records or shows activity. To work a step, follow
`docs/ANALYTICS_ROADMAP.md` → "How to work a step" and "Rules that apply to every step".

## Decisions (do not reopen without the commissioner)

- **First-party only.** No SDK, no third-party script, no `fetch` to anything outside the
  site. Same reasoning that keeps Sleeper off the request path.
- **Commissioner-only reads.** The one read route, `GET /api/admin/activity`, goes through
  `checkCommish()`. `page_visits` has no view in the `oracle` schema. It is in the
  never-expose list in `scripts/migrate-oracle.ts` and in `src/lib/oracle-schema.test.ts`,
  and `oracle-service.itest.ts` asserts the refusal.
- **The manager id comes from the session cookie, never the body.** `currentManagerId()`,
  exactly like `/api/queue`. A `managerId` sent in the body is stripped by zod, and a test
  sends one to prove it.
- **Off the polling path.** Nothing goes into `/api/state` or `src/lib/version.ts`, and the
  beacon never fires per poll. `/api/state` is polled every 400ms by every client; a
  tracker riding it is how the Neon data-transfer quota died once already. An
  integration test asserts `getState()` is byte-identical across a track call.
- **No gate change.** `src/lib/gate.ts` stays at three paths. `/api/track` is gated like
  every API (signed out → 401 from `src/proxy.ts`), and the beacon sends nothing from
  `/join`.
- **Only visible, active time counts.** The clock runs while
  `document.visibilityState === 'visible'` **and** there was input (pointer, key, wheel,
  scroll, touch) in the last `IDLE_MS = 5 min`. Returning to the tab counts as input. A
  draft board left on a TV all night counts five minutes, not nine hours.
- **One row per segment.** A segment ends on client navigation, on `visibilitychange →
  hidden`, on `pagehide`, on idle, or at `MAX_SECONDS = 1800` (then the next one starts,
  so nothing is lost). Each segment is one `navigator.sendBeacon` with a JSON `Blob`, with
  a `fetch(…, { keepalive: true })` fallback. Segments under `MIN_SECONDS = 2` are dropped
  on the client.
- **Store the raw path, derive the grouping.** The row stores the pathname without its
  query string or hash. Grouping into labels like "Member page" or "Gazette issue" is
  `pageGroup()`, a pure function run at read time, so a better grouping later rewrites no
  data. Unknown paths keep their own "Other: /path" row and are never dropped.
- **Commissioner visits are recorded** and hidden by default in the view ("Hide my own
  visits").
- **Retention is forever.** Ten people make a tiny table. It is in `scripts/backup.ts`.
- **Tell the league.** This is a decision, not polish. Wording is below.

## What was built

### Step 63 — the table
`scripts/migrate-activity.ts` (idempotent, `--test`), mirrored in `src/db/schema.ts`
(`pageVisits`, `PageVisit`) including the `CHECK`:

```
page_visits (
  id             serial PRIMARY KEY,
  manager_id     integer NOT NULL REFERENCES managers(id),
  path           text    NOT NULL,          -- pathname only, ≤ 200 chars
  started_at     timestamptz NOT NULL,      -- client-reported, clamped to the last day
  active_seconds integer NOT NULL CHECK (active_seconds BETWEEN 1 AND 1800),
  created_at     timestamptz NOT NULL DEFAULT now()
)
page_visits_manager_time_idx ON (manager_id, created_at)
page_visits_time_idx         ON (created_at)
```

`npm run db:migrate-activity` (and `-- --test`, also in the `db:test-migrate` chain).

### Step 64 — the derivations (`src/lib/activity.ts`)
`normalisePath`, `pageGroup` (built from the real `src/app/**/page.tsx` tree, and a test
walks that tree so a new page cannot silently fall into "Other"), `isUntrackedPath`,
`createActivityClock` (the visible-and-active timer as a pure state machine with the
time passed in), `activitySummary` (per manager, per page, the manager × page matrix, and
seconds per day in Pacific time with empty days filled), and `formatDuration`. Glossary
entry `active-time`.

### Step 65 — the beacon and `/api/track`
`src/server/activity-service.ts` (`recordVisit` is ONE statement: the abuse cap and the
insert together; `getActivity`; `activityMembers`). `POST /api/track` returns 204, 400 on
bad input, 401 signed out, and 429 past 120 rows in 10 minutes for one manager.
`src/components/ActivityBeacon.tsx` is mounted once in `src/app/layout.tsx`, renders
`null`, and wraps every browser call so tracking can never break a page.

### Step 66 — Admin → Activity
`GET /api/admin/activity?days=7|30|all&mine=0|1` behind `checkCommish()`.
`src/components/admin/ActivitySection.tsx`: range toggle, "Hide my own visits", per-member
table (time, visits, last seen, plus who was not seen), top pages, the who-reads-what heat
table, and minutes per day. A window with no visits says so in words rather than showing
zeros.

## Shipping

1. `npm run db:migrate-activity` against live **before** deploying. Without the table,
   every beacon gets a 500. The beacon swallows that, so no page breaks, but nothing is
   recorded and Admin → Activity shows its "run the migration" message.
2. Deploy.
3. Tell the league. Suggested wording:

   > Heads up: the draft site now keeps a simple record of which pages get used and for
   > how long, so I can see what's worth improving. It's built into our own site (no
   > Google, no ad trackers), it only counts time when the page is actually open and in
   > use, and only I can see it. The Glossary has an "Active time" entry that explains
   > exactly how it's counted.

## Known limits

- **A "visit" is a segment**, one unbroken stretch of active time on one page. Switching
  tabs and coming back makes two. The glossary says so.
- **The cap is not a lock.** A burst of parallel beacons can overshoot 120 by its own
  size. It is there to stop a runaway tab, not an adversary.
- **Time before hydration is not counted**, nor is time on a page that never hydrates.
- **`started_at` is the client's clock**, clamped to the last day against the database.
