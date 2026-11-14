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
import { resolvePackPath, ungroundedNumbers, type GazetteFacts, type Thread } from './gazette'

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

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

/** What a Writer files: today's Issue minus the game notes, which are their own call. */
export interface Draft {
  issueTitle: string
  lens: string
  headline: string
  deck: string
  column: string
  threads: Thread[]
}

/**
 * Strip the inline HTML a model sometimes reaches for. Every field is rendered
 * as text, so an em tag would reach the page as visible angle brackets. A
 * conservative tag list, so prose with a real angle bracket survives. The
 * reasoning is on `clean` in scripts/history/gazette.ts.
 */
export const stripMarkup = (s: string) =>
  s.replace(/<\/?(?:em|i|b|strong|p|br|span|h[1-6])\s*\/?>/gi, '').trim()

export const cleanDraft = (d: Draft): Draft => ({
  ...d,
  issueTitle: stripMarkup(d.issueTitle),
  lens: stripMarkup(d.lens),
  headline: stripMarkup(d.headline),
  deck: stripMarkup(d.deck),
  column: stripMarkup(d.column),
})

/** Everything the grounding gate reads in a draft: the prose, and only the prose. */
export const draftProse = (d: Pick<Draft, 'headline' | 'deck' | 'column'>) =>
  [d.headline, d.deck, d.column].join('\n\n')

/** Is this Dale's first issue? True when the notebook has no entry of his. */
export function isDalesFirstIssue(priorThreads: Thread[]): boolean {
  return !priorThreads.some((t) => t.id.startsWith('dale-'))
}

// ---------------------------------------------------------------------------
// The banned-phrase lint
// ---------------------------------------------------------------------------

/**
 * Phrases Dale does not use. One list, read by both the voice bible (which
 * prints it into the prompt) and the lint below, so the two cannot drift.
 *
 * Three families: the softeners that made earlier versions arch rather than
 * mean (docs/archive/PROGRESS_LOG_2026.md: "telling a model to be a bit mean
 * produces arch"); the stock phrases of any sports newsletter, which are what
 * make a paragraph sound like it could be about any league; and the
 * points-as-objects phrasing v16 was written to stop.
 *
 * Warn only, like misattribution: a banned phrase is a reason for a human to
 * read the draft, never a reason to drop it.
 */
export const BANNED_PHRASES = [
  // softeners
  'to be fair',
  'respectable',
  'in fairness',
  'in most households',
  'all things considered',
  // the record speaking for Dale
  'the record remembers',
  'the numbers say',
  "the numbers don't lie",
  'the numbers do not lie',
  // stock sportswriting
  'at the end of the day',
  'make no mistake',
  "let's be honest",
  "it's worth noting",
  'it is worth noting',
  'a tale of two',
  'when the dust settled',
  'only time will tell',
  'buckle up',
  'statement win',
  'a masterclass',
  'let that sink in',
  'the elephant in the room',
  'a testament to',
  'silver lining',
  'on any given sunday',
  'in a league where',
  // points as objects
  'in the drawer',
  'left in the hallway',
  'walked out with',
  'points on the floor',
] as const

/** Banned phrases a piece of prose contains, case-insensitively, each once. */
export function bannedPhrases(text: string): string[] {
  const lower = text.toLowerCase().replace(/[‘’]/g, "'")
  return BANNED_PHRASES.filter((p) => lower.includes(p))
}

// ---------------------------------------------------------------------------
// Judge
// ---------------------------------------------------------------------------

/**
 * A small seeded PRNG (mulberry32). The Judge's labels must be reproducible --
 * the same week always shuffles the same way, so a replay is comparable -- and
 * must not leak which plan a draft came from. Math.random gives neither.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The Judge's seed for a week: season x 100 + week, as the roadmap fixes it. */
export const judgeSeed = (season: number, week: number) => season * 100 + week

/**
 * Label items A, B, C... in a seeded random order. Returns the items in LABEL
 * order, each with its label, so "A" is not always plan one.
 */
export function blindLabels<T>(items: T[], seed: number): Array<{ label: string; item: T }> {
  const order = items.map((_, i) => i)
  const rand = seededRandom(seed)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order.map((idx, k) => ({ label: String.fromCharCode(65 + k), item: items[idx] }))
}

export interface FlaggedLine {
  label: string
  line: string
  why: string
}

export interface Verdict {
  ranking: string[]
  winner: string
  reasons: string
  /** Recorded only, never acted on (v1). */
  flaggedLines: FlaggedLine[]
}

/** Everything wrong with a verdict: the ranking must be a permutation, led by the winner. */
export function validateVerdict(v: Verdict, labels: string[]): string[] {
  const problems: string[] = []
  const want = [...labels].sort().join(',')
  if ([...v.ranking].sort().join(',') !== want) {
    problems.push(`RANKING must list each of ${labels.join(', ')} exactly once; got ${v.ranking.join(', ') || 'nothing'}`)
  }
  if (v.winner !== v.ranking[0]) problems.push(`WINNER must be the first label in RANKING`)
  if (!labels.includes(v.winner)) problems.push(`WINNER "${v.winner}" is not one of ${labels.join(', ')}`)
  for (const f of v.flaggedLines) {
    if (!labels.includes(f.label)) problems.push(`a flagged line names label "${f.label}", which does not exist`)
  }
  if (!v.reasons.trim()) problems.push('give REASONS')
  return problems
}

/** With one surviving draft there is nothing to judge, and the record says so. */
export const onlySurvivor = (label: string): Verdict => ({
  ranking: [label],
  winner: label,
  reasons: 'only survivor',
  flaggedLines: [],
})

// ---------------------------------------------------------------------------
// Game notes
// ---------------------------------------------------------------------------

/** One note per game, in order, none empty. */
export function validateGameNotes(notes: string[], gameCount: number): string[] {
  const problems: string[] = []
  if (notes.length !== gameCount) problems.push(`write exactly ${gameCount} notes, one per game in order, not ${notes.length}`)
  notes.forEach((n, i) => {
    if (!n.trim()) problems.push(`note ${i + 1} is empty`)
  })
  return problems
}

// ---------------------------------------------------------------------------
// Storage (step 83)
// ---------------------------------------------------------------------------

/**
 * The whole run behind one pipeline issue, as stored on `week_issues.pipeline`
 * and in the committed mirror. Null on every issue written single-pass.
 *
 * Kept whole rather than trimmed to the winner because each part answers a
 * question the published prose cannot: the storylines are what the Desk thought
 * mattered, the plans are what `--replay --from plans` re-writes from, the losing
 * drafts and the verdict are what the bake-off and any later argument about the
 * Judge are settled with, and `lead` is what next week's rotation reads.
 */
export interface StoredPipeline {
  versions: Record<string, number>
  storylines: Storyline[]
  stale: StaleStory[]
  plans: Plan[]
  drafts: Array<{
    label: string
    planIndex: number
    issue: Draft
    flagged: { misattributed: string[]; banned: string[] }
    repaired: boolean
  }>
  /** Plans whose Writer failed the gate twice: the plan index and the error, no prose. */
  dropped: Array<{ planIndex: number; error: string }>
  verdict: Verdict
  lead: { storylineId: string; managers: string[] }
}

/**
 * Every figure in a stored run that its own pack cannot account for.
 *
 * The same fields the stages were gated on when the run was made: the Desk's
 * prose (`validateDesk`), the plans' prose (`validatePlans`) and each judged
 * draft's headline, deck and column. Dropped drafts carry no prose, only the
 * error that dropped them, and are not read. So for a run that came out of the
 * room this is empty by construction, and the audit and the archive test use it
 * to prove the committed copy still says what was checked.
 */
export function pipelineGroundingProblems(p: StoredPipeline, facts: GazetteFacts): string[] {
  const problems: string[] = []
  for (const s of p.storylines) {
    problems.push(...groundingProblems(`storyline "${s.id}"`, [s.whyTheChatCares, ...s.possibleTakes].join('\n'), facts))
  }
  p.stale.forEach((st, i) => problems.push(...groundingProblems(`stale[${i}]`, st.description, facts)))
  p.plans.forEach((plan, i) => {
    const where = `plan ${i + 1}`
    plan.beats.forEach((b, j) => {
      problems.push(...groundingProblems(`${where} beat ${j + 1}`, [b.take, b.jokePremise].join('\n'), facts))
    })
    problems.push(
      ...groundingProblems(where, [plan.headlineAngle, plan.coldOpenPremise, plan.close, plan.dalesStance].join('\n'), facts),
    )
  })
  for (const d of p.drafts) problems.push(...groundingProblems(`draft ${d.label}`, draftProse(d.issue), facts))
  return problems
}

/**
 * The lead a stored issue recorded, for next week's rotation.
 *
 * `undefined` for anything that is not a well-formed lead: an issue written
 * single-pass has a null `pipeline`, and a malformed one must not bar a manager
 * from leading. It contributes nobody, which is what `recentlyLed` expects.
 */
export function storedLead(pipeline: unknown): RecentLead['lead'] {
  const lead = (pipeline as { lead?: unknown } | null | undefined)?.lead as
    | { storylineId?: unknown; managers?: unknown }
    | undefined
  if (!lead || typeof lead.storylineId !== 'string' || !Array.isArray(lead.managers)) return undefined
  if (!lead.managers.every((m): m is string => typeof m === 'string')) return undefined
  return { storylineId: lead.storylineId, managers: lead.managers }
}
