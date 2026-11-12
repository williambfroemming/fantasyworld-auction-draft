/**
 * The Gazette's editorial room: the pure half.
 *
 * One call used to choose the stories, plan the piece and write it, and it
 * converged on the same piece every week. The room splits that into a Story
 * Desk (what is the group chat talking about), an Editor (three different
 * plans), three Writers (one per plan, in parallel) and a blind Judge. See
 * docs/GAZETTE_ROADMAP.md.
 *
 * Everything here is deterministic and unit-tested: the stage contracts, the
 * validators that run between stages, the seeded shuffle the Judge reads, the
 * banned-phrase lint. The model calls live in scripts/history/gazette-pipeline.ts
 * and the prompts in scripts/history/gazette-room/.
 *
 * The validators are where the grounding gate moves UPSTREAM. A figure invented
 * in a storyline or a plan is one a Writer will faithfully reproduce, so plan
 * text is checked with the same `ungroundedNumbers()` as the final prose, against
 * the same full pack.
 */
import { resolvePackPath, ungroundedNumbers, type GazetteFacts } from './gazette'

// ---------------------------------------------------------------------------
// Story Desk
// ---------------------------------------------------------------------------

export interface Storyline {
  /** Kebab-case words, no digits: "mario-jt-carry". Plans refer to it by this. */
  id: string
  /** Managers exactly as the pack names them. The first is the story's subject. */
  managers: string[]
  /** Pack paths, every one of which must resolve. See `pathIndex()`. */
  evidence: string[]
  whyTheChatCares: string
  possibleTakes: string[]
  /** 1-10: how loudly the group chat would be talking about it. */
  heat: number
}

export interface StaleStory {
  description: string
  lastIssueWeek: number
}

export interface DeskOutput {
  storylines: Storyline[]
  stale: StaleStory[]
}

export const DESK_MIN_STORYLINES = 5
export const DESK_MAX_STORYLINES = 10

const ID_RE = /^[a-z][a-z-]*[a-z]$/

/** The managers a pack knows about, in the spelling it uses. */
export function managersIn(facts: GazetteFacts): Set<string> {
  return new Set(facts.standings.map((s) => s.manager))
}

/** Digits in a piece of plan text the full pack cannot account for, labelled by where. */
function groundingProblems(where: string, text: string, facts: GazetteFacts): string[] {
  return ungroundedNumbers(text, facts).map((f) => `${where}: figure not in the pack: ${f}`)
}

/**
 * Everything wrong with a Story Desk's output. Empty means it can go to the
 * Editor. Each line is written to be read back to the model in the retry.
 */
export function validateDesk(desk: DeskOutput, facts: GazetteFacts): string[] {
  const problems: string[] = []
  const managers = managersIn(facts)
  const n = desk.storylines.length
  if (n < DESK_MIN_STORYLINES || n > DESK_MAX_STORYLINES) {
    problems.push(`file between ${DESK_MIN_STORYLINES} and ${DESK_MAX_STORYLINES} storylines, not ${n}`)
  }

  const seen = new Set<string>()
  for (const s of desk.storylines) {
    const where = `storyline "${s.id}"`
    if (!ID_RE.test(s.id)) problems.push(`${where}: an id is lowercase words joined by hyphens, no digits`)
    if (seen.has(s.id)) problems.push(`${where}: duplicate id`)
    seen.add(s.id)
    if (!s.managers.length) problems.push(`${where}: names no manager`)
    for (const m of s.managers) {
      if (!managers.has(m)) problems.push(`${where}: "${m}" is not a manager in this league; use ${[...managers].join(', ')}`)
    }
    if (!s.evidence.length) problems.push(`${where}: cites no evidence`)
    for (const p of s.evidence) {
      if (resolvePackPath(facts, p) === null) problems.push(`${where}: evidence path "${p}" does not exist in the pack`)
    }
    if (!Number.isInteger(s.heat) || s.heat < 1 || s.heat > 10) problems.push(`${where}: heat is a whole number from 1 to 10`)
    problems.push(...groundingProblems(where, [s.whyTheChatCares, ...s.possibleTakes].join('\n'), facts))
  }
  desk.stale.forEach((st, i) => {
    problems.push(...groundingProblems(`stale[${i}]`, st.description, facts))
  })
  return problems
}

/** The retry message: what was wrong, and that the brief still stands. */
export function repairNote(stage: string, problems: string[]): string {
  return (
    `Your ${stage} has problems an automated check found:\n` +
    problems.map((p) => `  - ${p}`).join('\n') +
    '\nReturn the whole thing again with these fixed. Cite only paths from PATHINDEX, name managers ' +
    'exactly as the pack does, and write any count as a word. Everything else about the brief still ' +
    'stands: fix the problems, do not play it safe.'
  )
}
