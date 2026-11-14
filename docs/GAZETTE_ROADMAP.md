# Gazette Roadmap — the editorial room (section N, steps 78–85)

**Numbering.** Built on a branch as section M, steps 67–74, and renumbered to section N, steps
78–85, when it merged (`docs/PROJECT_PLAN.md` §13). Commits and the first five log entries keep
the old numbers.

Self-contained build plan for replacing the Gazette's single writing call with a
multi-stage editorial pipeline. Written to be handed to an agent working in its
own worktree. **Read `AGENTS.md` (the Gazette non-negotiables especially) and the
Gazette entries in `docs/PROGRESS_LOG.md` / `docs/archive/` before starting.**

Follow the working rule from `AGENTS.md` on every step: one `PROGRESS_LOG.md`
entry with **Learned** and **Watch out for**, flip the step's box (add steps
78–85 to `docs/PROJECT_PLAN.md` §13 in step 78), commit docs with the code.

---

## 1. Why

Sixteen prompt versions have not moved the Gazette past "not that compelling."
The v16 docblock in `scripts/history/gazette-prompt.ts` names the symptom:
*"underneath the costume every issue was the same piece."*

The cause is structural, not verbal. One call (`callModel` in
`scripts/history/gazette.ts`) receives a flat ~15KB pack of 20+ sections plus a
six-part "shape of the column", and in a single pass must **choose** the stories,
**plan** the piece and **write** it. It converges on the same moves every week:
cold open → lead → roast round → historical gut punch → close → rankings.

**Decision (owner):** do not iterate on v16. Rebuild toward what Dale Brennan was
*meant* to be — a mean, specific, opinionated, first-person bar-stool columnist
who could only be writing about this league — by separating story selection,
planning and prose into distinct calls.

## 2. Locked decisions

| Decision | Reason |
|---|---|
| **Plan → several drafts → blind judge picks one.** No Critic → Rewriter loop. | Every full rewrite is a fresh chance to introduce ungrounded figures, and rewrites sand the voice down. The existing repair path already showed this: week 11 of 2025 "read like a stat block". Selection keeps voice; revision flattens it. |
| **No new "lore retrieval" or "fact validation" agents.** | They exist already: the deterministic pack (`weekInReview`), the `threads` notebook, `priorColumns`, `recordBook`, `thisWeekInHistory`, and `ungroundedNumbers()`. Reuse them. |
| **The Story Desk selects from the pack; it never reads raw data.** | The pack is grounded and future-proofed (`upTo`). Every storyline cites pack paths, so evidence is checkable *before* prose exists. |
| **The Writer sees only the pack slices its plan cites.** | A narrower menu is the main defence against template collapse. Grounding is still checked against the **full** pack. |
| **The voice bible is written fresh from Dale's goals**, not adapted from the v16 prompt. | Owner's call. The number contract, the floor and "what you cannot know" carry over verbatim — they are rules, not voice. |
| **The LLM judge is not the success metric. A blind league A/B is.** | A model grading its own family's prose rewards rubric compliance, not funny. |
| **Week editions only.** The season preview (`gazette-preview-prompt.ts`, `--preview`) stays single-pass. | Different paper, different pack; out of scope. |
| **Behind `--pipeline` until the bake-off wins.** The weekly cron is untouched until step 85. | The live Tuesday job must keep working throughout. |

## 3. Target pipeline

```
weekInReview() pack                      deterministic — exists, unchanged
  │
  ├─▶ 1 STORY DESK      storylines[], each citing pack paths; stale[] stories
  │        └─ validate: every path resolves, every digit grounded (1 retry)
  │
  ├─▶ 2 EDITOR          3 plans, distinct lead storylines
  │        └─ validate: distinct leads; lead manager ≠ lead of last 2 issues
  │
  ├─▶ 3 WRITER ×3       parallel; voice bible + one plan + sliceFacts(plan paths) + notebook
  │        └─ grounding gate per draft vs FULL pack (existing 1-repair path);
  │           a draft that still fails is DROPPED; fail the issue only if all 3 fail
  │
  ├─▶ 4 JUDGE           seeded blind shuffle (A/B/C); forced ranking; winner + reasons
  │
  ├─▶ GAME NOTES        separate small call: plain record, outside Dale's voice
  │
  └─▶ store             winner's prose + winner's threads; whole run in `pipeline` jsonb
```

### Stage contracts (JSON via `output_config.format`, as `callModel` does today)

**Story Desk** — effort `medium`
- In: full pack, `priorThreads`, leads of the last three issues.
- Out: `{ storylines: [{ id, managers[], evidence: [packPath], whyTheChatCares, possibleTakes[], heat (1–10) }], stale: [{ description, lastIssueWeek }] }`
- Its job is editorial judgment: what would the group chat actually be talking
  about? Prefer stories with a pattern, a price, a history or a grudge attached.

**Editor** — effort `high`
- In: storylines, notebook, prior leads, genre (headline + cold open only).
- Out: `{ plans: [{ lead: storylineId, headlineAngle, coldOpenPremise, beats: [{ storylineId, mode: 'roast'|'props'|'gutPunch'|'prediction', take, jokePremise, figures: [packPath] }], close, dalesStance }] }` — exactly three plans, 4–7 beats each.
- `dalesStance` is the one strong opinion the column commits to. Every plan needs one.

**Writer** — effort `high`, three calls in parallel
- In: voice bible (system), one plan, `sliceFacts(pack, allPathsInPlan)`, `priorThreads`, `priorColumns` (continuity only — "do not imitate").
- Out: `{ issueTitle, lens, headline, deck, column, threads }` — today's `Issue` minus `gameNotes`.

**Judge** — effort `high`
- In: the drafts that passed grounding, labelled by a seeded shuffle (seed = season×100+week), plus the rubric. **Not** the plans, the labels' origin, or which model wrote what.
- Rubric, in priority order: could only be about this league · would a member read it voluntarily · genuinely funny moments · tells stories rather than recaps · Dale's voice consistent · no filler or generic phrasing.
- Out: `{ ranking: ['B','A','C'], winner: 'B', reasons, flaggedLines: [{ label, line, why }] }`. `flaggedLines` are recorded only in v1, never acted on.

**Game notes** — effort `low`
- In: `games` from the pack. Out: `string[]`, one per game, same order. Same grounding gate.

## 4. Invariants this must preserve (from `AGENTS.md` — non-negotiable)

- **An issue renders from its own stored `facts`.** The pack is still snapshotted
  exactly as today; the archive grounding vitest test must pass unchanged.
- **The grounding check is the publish gate.** `ungroundedNumbers()` runs on the
  final prose (headline, deck, column, game notes) against the full pack. Keep the
  `misattributedNumbers()` warning. Also ground the Story Desk / Editor text — a
  number invented in a plan will be faithfully reproduced by a writer.
- **One notebook.** Only the winning draft's `threads` are stored. Desk and Editor
  read `priorThreads` and never write one. Do not add a lore file.
- **Nothing knows the future.** Every stage reads only the pack (already `upTo`-filtered). No stage gets a database handle.
- **Issues are ordered.** Backfill stays chronological and serial; `--sample`
  threads the *winner's* notebook into the next week in memory.
- **Versioning.** `PROMPT_VERSION = 17` means "pipeline". Each stage file exports
  its own `*_VERSION`; all are stored in `pipeline.versions`.
- **No backticks in prompts.** Each new prompt file contains exactly two backticks;
  extend the structural test in `src/lib/gazette.test.ts` to cover every file in
  the new directory.
- **The genre dresses the headline and the cold open only.** The calendar
  (`GENRE_CALENDARS`) is untouched.
- **Mean about fantasy football, never about the person.** The floor carries over verbatim.
- **Never develop against Neon.** Use `npm run db:local:up` / `npm run local -- …`.

## 5. Build steps

Each step is independently committable and leaves the weekly job working.

### Step 78 — pack paths: `resolvePackPath` and `sliceFacts`
- In `src/lib/gazette.ts`: `resolvePackPath(facts, path)` for dotted/indexed
  paths (`games[2].margin`, `milestones[0]`, `rosters[3]`, `stats[1]`,
  `thisWeekInHistory[0]`, `belt`, …) and `sliceFacts(facts, paths)` returning a
  pack with only those subtrees plus the always-needed scalars (`season`, `week`,
  `weekLabel`, `genre`, `phase`, `teamsPlaying`).
- Add a `pathIndex(facts)` helper that lists every addressable path with a short
  label — this is what the Story Desk is shown so it can cite real paths.
- Tests: round-trip on a committed 2025 pack; unknown path → null; slice of all
  paths deep-equals the pack's content.
- Add steps 78–85 to `docs/PROJECT_PLAN.md` §13.

### Step 79 — the Story Desk
- New directory `scripts/history/gazette-room/`. `desk-prompt.ts` (prompt + `DESK_VERSION`).
- Generalise `callModel` in `scripts/history/gazette.ts` to take `(system, userContent, schema, effort)`; keep the old signature working for the preview and the v16 path.
- Deterministic validation: every `evidence` path resolves; prose fields pass `ungroundedNumbers`. One retry naming the bad paths/figures.
- CLI: `npm run gazette -- 2025 7 --desk` prints storylines; calls only the desk.

### Step 80 — the Editor
- `editor-prompt.ts` + `EDITOR_VERSION`.
- Deterministic checks: exactly three plans; distinct `lead`; lead storyline's
  primary manager did not lead either of the previous two issues (read from
  their stored `pipeline.lead`; issues without a pipeline are ignored); every
  `figures` path resolves. One retry on failure.
- CLI: `--plans` prints desk + plans.

### Step 81 — the voice bible and the Writer
- `voice.ts` (the bible) + `writer-prompt.ts` + `WRITER_VERSION`. Write the bible
  fresh from Dale's character (see the v16 prompt's WHO YOU ARE for the brief, not
  its wording). It must contain: who Dale is; how he uses numbers ("like a
  columnist, not an accountant"); humour principles (specific over generic, roast
  decisions not people, callbacks, escalate, never explain the joke); a banned
  phrase list; the number contract, WHAT YOU CANNOT KNOW and THE FLOOR **verbatim**
  from v16; the notebook rules; the first-issue management note rule.
- Leave a clearly marked `EXEMPLARS` section with a TODO: the commissioner will
  supply 2–3 hand-written Dale paragraphs. Do not have a model write them.
- Fan out three writers with `Promise.allSettled`, each through the existing
  `write()` grounding + one-repair path (generalised). Drop drafts that still fail.
- Add a deterministic banned-phrase lint (warn only, like misattribution).

### Step 82 — the Judge and game notes
- `judge-prompt.ts` + `JUDGE_VERSION`; seeded shuffle (pure function, unit-tested).
- With one surviving draft, skip the judge and record `{ winner, reason: 'only survivor' }`.
- `gamenotes-prompt.ts`; split game notes out of the writer schema.
- Wire the full pipeline behind `--pipeline` in `one()`; `--sample … --pipeline`
  threads winners' notebooks across weeks.

### Step 83 — storage
- `week_issues.pipeline jsonb` (nullable — every existing issue has none). Add it
  in `scripts/migrate-gazette.ts` idempotently (`ADD COLUMN IF NOT EXISTS`); mirror
  in `src/db/schema.ts`. **Not** `drizzle-kit push`.
- Contents: `{ versions, storylines, plans, drafts: [{ label, planIndex, issue, flagged, repaired }], verdict, lead }`.
- Write it to `data/history/gazette/<season>.json` too; update `--seed`, `--audit`
  and `store()` to carry it. `src/server/gazette-service.ts` ignores it for now.
- `--replay --from plans`: re-run writers + judge from the stored plans and pack,
  so a diff isolates voice from selection.

### Step 84 — the bake-off
- `npm run gazette -- --bakeoff 2025 6 3`: dry run. For three consecutive weeks,
  generate the v16 single-pass edition (existing path) and the pipeline edition
  from the same pack, threading each arm's own notebook.
- Output a static, self-contained HTML page under `backups/` or a scratch dir
  (never `public/`): each week shows "Edition X" and "Edition Y" side by side with
  per-week randomised labels; the answer key goes in a separate local JSON.
- The owner shares it with the league. **Stop here and report**; step 85 waits
  for the vote.

### Step 85 — switch over
- Only after the pipeline wins the vote: make the pipeline the default for week
  editions, keep `--single-pass` for comparison, update
  `.github/workflows/weekly-history.yml` only if its command changes.
- Update `AGENTS.md` Gazette non-negotiables: the pipeline shape, "only the winner
  writes the notebook", "the judge is not the metric", "plans are grounded too".
- Optionally surface "From the editor's desk" (the judge's reasons) on the issue page.

## 6. Verification

- `npm test` — path resolution, slicing, lead rotation, seeded shuffle, backtick
  test over every prompt file, and the **unchanged** archive grounding test.
- `npm run local -- npm run db:migrate-gazette` then
  `npm run local -- npm run gazette -- --sample 2025 6 3 --pipeline`: read the
  three winners in order; check the notebook carries forward and the lead rotates.
- `npm run gazette -- --audit` passes on the whole archive.
- `--replay --from plans` produces a prose-only diff.
- Cost check: log tokens per stage; expect ~6 Opus calls per issue (vs 1–2 today).

## 7. Out of scope

- The season preview.
- Acting on the judge's `flaggedLines` (a possible v2 targeted-line edit).
- League chat history — not available, and the prompt forbids claims about it.
- Richer raw material from weekly player stat lines (`docs/archive/PLAYER_STATS_ROADMAP.md`,
  steps 63–66). Not a dependency, but once it lands the Story Desk should see it
  via `pathIndex`.
