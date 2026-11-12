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
    '\nReturn the whole thing again with these fixed. Cite only pack paths you were shown, name ' +
    'managers exactly as the pack does, write any count as a word, and write a score as 130 to 106. ' +
    'Everything else about the brief still stands: fix the problems, do not play it safe.'
  )
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

export const BEAT_MODES = ['roast', 'props', 'gutPunch', 'prediction'] as const
export type BeatMode = (typeof BEAT_MODES)[number]

export interface Beat {
  storylineId: string
  mode: BeatMode
  /** What Dale thinks about it, in a sentence. */
  take: string
  /** The joke, as a premise for the Writer to execute -- not the finished line. */
  jokePremise: string
  /** Pack paths for the one or two figures this beat uses. */
  figures: string[]
}

export interface Plan {
  /** A storyline id from the Desk. */
  lead: string
  headlineAngle: string
  coldOpenPremise: string
  beats: Beat[]
  close: string
  /** The one strong opinion this version of the column commits to. */
  dalesStance: string
}

export interface EditorOutput {
  plans: Plan[]
}

export const PLAN_COUNT = 3
export const MIN_BEATS = 4
export const MAX_BEATS = 7

/** What an earlier issue led with. Only pipeline issues know their lead storyline. */
export interface RecentLead {
  week: number
  headline: string
  lead?: { storylineId: string; managers: string[] }
}

/**
 * The managers whose stories led either of the previous two issues.
 *
 * "Previous two" is the two most recent issues before this week, whatever they
 * were -- an issue written before the pipeline has no recorded lead and simply
 * contributes nobody, rather than being skipped over to reach further back.
 * Only the primary manager (the first named) counts: a lead about Bryan that
 * mentions Mario is Bryan's lead.
 */
export function recentlyLed(recent: RecentLead[]): Set<string> {
  const lastTwo = [...recent].sort((a, b) => a.week - b.week).slice(-2)
  return new Set(lastTwo.map((r) => r.lead?.managers[0]).filter((m): m is string => !!m))
}

/** Every pack path a plan cites, deduplicated: what its Writer's slice is built from. */
export function planPaths(plan: Plan, desk: DeskOutput): string[] {
  const used = new Set(plan.beats.map((b) => b.storylineId).concat(plan.lead))
  const paths = desk.storylines.filter((s) => used.has(s.id)).flatMap((s) => s.evidence)
  return [...new Set([...paths, ...plan.beats.flatMap((b) => b.figures)])]
}

/** Everything wrong with the Editor's plans. Empty means the Writers can start. */
export function validatePlans(
  out: EditorOutput,
  desk: DeskOutput,
  facts: GazetteFacts,
  recent: RecentLead[],
): string[] {
  const problems: string[] = []
  const stories = new Map(desk.storylines.map((s) => [s.id, s]))
  const barred = recentlyLed(recent)

  if (out.plans.length !== PLAN_COUNT) problems.push(`file exactly ${PLAN_COUNT} plans, not ${out.plans.length}`)
  const leads = out.plans.map((p) => p.lead)
  if (new Set(leads).size !== leads.length) problems.push(`the plans must have different leads; got ${leads.join(', ')}`)

  out.plans.forEach((plan, i) => {
    const where = `plan ${i + 1}`
    const lead = stories.get(plan.lead)
    if (!lead) {
      problems.push(`${where}: lead "${plan.lead}" is not a storyline id`)
    } else if (barred.has(lead.managers[0])) {
      problems.push(
        `${where}: leads with ${lead.managers[0]}, whose story led one of the last two issues; lead with somebody else`,
      )
    }
    if (plan.beats.length < MIN_BEATS || plan.beats.length > MAX_BEATS) {
      problems.push(`${where}: between ${MIN_BEATS} and ${MAX_BEATS} beats, not ${plan.beats.length}`)
    }
    if (!plan.beats.some((b) => b.storylineId === plan.lead)) problems.push(`${where}: no beat covers its own lead`)
    if (!plan.dalesStance.trim()) problems.push(`${where}: has no stance`)
    plan.beats.forEach((b, j) => {
      const bw = `${where} beat ${j + 1}`
      if (!stories.has(b.storylineId)) problems.push(`${bw}: "${b.storylineId}" is not a storyline id`)
      if (!(BEAT_MODES as readonly string[]).includes(b.mode)) problems.push(`${bw}: mode "${b.mode}" is not one of ${BEAT_MODES.join(', ')}`)
      for (const p of b.figures) {
        if (resolvePackPath(facts, p) === null) problems.push(`${bw}: figure path "${p}" does not exist in the pack`)
      }
      problems.push(...groundingProblems(bw, [b.take, b.jokePremise].join('\n'), facts))
    })
    problems.push(
      ...groundingProblems(where, [plan.headlineAngle, plan.coldOpenPremise, plan.close, plan.dalesStance].join('\n'), facts),
    )
  })
  return problems
}
