# Progress Log

**Append-only.** Never edit a past entry — if something turns out wrong, write a new entry correcting it and note which entry it supersedes. The history of what we believed and when is part of the value.

One entry per completed build step from `PROJECT_PLAN.md` §13. The **Learned** and **Watch out for** lines are the point of this file: they're the things that cost an hour to find and five seconds to write down, and they're exactly what a fresh context window otherwise pays for twice. An entry with an empty **Learned** line is a smell, not a clean run.

### Template

```markdown
## Step N — <name>
**Date:** YYYY-MM-DD  **Status:** done
**Built:** files/modules created or changed
**Decisions:** anything chosen that wasn't already in PROJECT_PLAN.md (and update that file too)
**Learned:** the non-obvious thing. Be specific.
**Watch out for:** the trap the next person would otherwise fall into
**Next:** step N+1
```

### Where the earlier entries are

| Steps | File |
|---|---|
| 1–37, and everything written before 2026-11-10 | `docs/archive/PROGRESS_LOG_2026.md` (about 3,900 lines) |
| 38–76: analytics, admin panel, site structure, activity, player stats, accounts | `docs/archive/PROGRESS_LOG_STEPS_38-76.md` |

**You do not need to read the archive to start a step.** The lessons that still bind are the
non-negotiables in `AGENTS.md`; search the archive when a source comment cites "PROGRESS_LOG
step N" or when you want the history behind one of those rules.

This file starts at **step 77**. The next new step is 78; see the numbering note in
`docs/PROJECT_PLAN.md` §13.

---
