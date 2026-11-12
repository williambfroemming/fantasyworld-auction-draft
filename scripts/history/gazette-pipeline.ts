/**
 * The Gazette's editorial room: the model-calling half.
 *
 *   weekInReview() pack
 *     -> Story Desk   storylines, each citing pack paths       (gazette-room/desk-prompt.ts)
 *     -> Editor       three plans, distinct leads               (gazette-room/editor-prompt.ts)
 *     -> Writer x3    one draft per plan, in parallel           (gazette-room/writer-prompt.ts, voice.ts)
 *     -> Judge        blind, seeded labels; picks one           (gazette-room/judge-prompt.ts)
 *     + game notes    the plain record, its own small call      (gazette-room/gamenotes-prompt.ts)
 *
 * See docs/GAZETTE_ROADMAP.md. Everything here runs only behind a flag on
 * scripts/history/gazette.ts (--pipeline, or a stage flag); the weekly job,
 * the single-pass edition and the season preview do not touch it.
 *
 * Only the winning draft's notebook survives a run. The Desk and the Editor
 * read the notebook and never write one, and the losing drafts' threads are
 * kept for the record only -- there is one notebook, and it is the winner's.
 *
 * Each stage is one structured call, a deterministic validation from
 * src/lib/gazette-room.ts, and at most one retry that reads the problems back.
 * One retry rather than a loop, for the same reason the single-pass edition has
 * one: a second failure on the same pack is a prompt problem, and a third
 * attempt hides it.
 *
 * No stage gets a database handle. Each reads only the pack, which is already
 * filtered to what was known at press time, plus the notebook it is handed.
 */
import {
  misattributedNumbers,
  pathIndex,
  sliceFacts,
  ungroundedNumbers,
  type GazetteFacts,
  type Thread,
} from '../../src/lib/gazette'
import {
  BEAT_MODES,
  bannedPhrases,
  blindLabels,
  judgeSeed,
  onlySurvivor,
  stripMarkup,
  validateGameNotes,
  validateVerdict,
  type Verdict,
  cleanDraft,
  draftProse,
  isDalesFirstIssue,
  planPaths,
  repairNote,
  validateDesk,
  validatePlans,
  type DeskOutput,
  type Draft,
  type EditorOutput,
  type Plan,
  type RecentLead,
} from '../../src/lib/gazette-room'
import { callJson } from './gazette-model'
import { DESK_PROMPT, DESK_VERSION } from './gazette-room/desk-prompt'
import { EDITOR_PROMPT, EDITOR_VERSION } from './gazette-room/editor-prompt'
import { GAMENOTES_PROMPT, GAMENOTES_VERSION } from './gazette-room/gamenotes-prompt'
import { JUDGE_PROMPT, JUDGE_VERSION } from './gazette-room/judge-prompt'
import { VOICE_VERSION } from './gazette-room/voice'
import { WRITER_PROMPT, WRITER_VERSION } from './gazette-room/writer-prompt'

export type { RecentLead }

/** The pack minus the fields each stage is handed explicitly, or not at all. */
export function packContent(facts: GazetteFacts): Partial<GazetteFacts> {
  const {
    priorThreads: _t,
    priorColumns: _c,
    priorHeadlines: _h,
    priorLenses: _l,
    reservedGenres: _r,
    ...rest
  } = facts
  return rest
}

const STRING_ARRAY = { type: 'array', items: { type: 'string' } }

const DESK_SCHEMA = {
  type: 'object',
  properties: {
    storylines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          managers: STRING_ARRAY,
          evidence: STRING_ARRAY,
          whyTheChatCares: { type: 'string' },
          possibleTakes: STRING_ARRAY,
          heat: { type: 'integer' },
        },
        required: ['id', 'managers', 'evidence', 'whyTheChatCares', 'possibleTakes', 'heat'],
        additionalProperties: false,
      },
    },
    stale: {
      type: 'array',
      items: {
        type: 'object',
        properties: { description: { type: 'string' }, lastIssueWeek: { type: 'integer' } },
        required: ['description', 'lastIssueWeek'],
        additionalProperties: false,
      },
    },
  },
  required: ['storylines', 'stale'],
  additionalProperties: false,
}

/**
 * A structured call, validated, with one retry that names what was wrong.
 * Throws if the retry is still invalid.
 */
async function validated<T>(
  stage: string,
  call: (followUps: string[]) => Promise<T>,
  validate: (out: T) => string[],
): Promise<T> {
  let out = await call([])
  let problems = validate(out)
  if (problems.length) {
    console.log(`  · ${stage}: ${problems.length} problem(s) — asking once more`)
    for (const p of problems.slice(0, 12)) console.log(`      ${p}`)
    out = await call([repairNote(stage, problems)])
    problems = validate(out)
    if (problems.length) {
      throw new Error(`${stage} still invalid after a retry:\n${problems.map((p) => `  ${p}`).join('\n')}`)
    }
  }
  return out
}

export async function runDesk(
  facts: GazetteFacts,
  priorThreads: Thread[],
  recentLeads: RecentLead[],
): Promise<DeskOutput> {
  const user = {
    pathIndex: pathIndex(facts),
    pack: packContent(facts),
    priorThreads,
    recentLeads,
  }
  return validated<DeskOutput>(
    'story desk',
    (followUps) =>
      callJson<DeskOutput>({
        stage: 'desk',
        system: DESK_PROMPT,
        user,
        followUps,
        schema: DESK_SCHEMA,
        effort: 'medium',
      }),
    (desk) => validateDesk(desk, facts),
  )
}

export function showDesk(desk: DeskOutput) {
  console.log(`\n  STORY DESK (v${DESK_VERSION})`)
  for (const s of desk.storylines) {
    console.log(`\n  [${String(s.heat).padStart(2)}] ${s.id} — ${s.managers.join(', ')}`)
    console.log(`       ${s.whyTheChatCares}`)
    for (const t of s.possibleTakes) console.log(`       › ${t}`)
    console.log(`       evidence: ${s.evidence.join(', ')}`)
  }
  if (desk.stale.length) {
    console.log('\n  stale:')
    for (const st of desk.stale) console.log(`    (wk ${st.lastIssueWeek}) ${st.description}`)
  }
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const EDITOR_SCHEMA = {
  type: 'object',
  properties: {
    plans: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          lead: { type: 'string' },
          dalesStance: { type: 'string' },
          headlineAngle: { type: 'string' },
          coldOpenPremise: { type: 'string' },
          beats: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                storylineId: { type: 'string' },
                mode: { type: 'string', enum: [...BEAT_MODES] },
                take: { type: 'string' },
                jokePremise: { type: 'string' },
                figures: STRING_ARRAY,
              },
              required: ['storylineId', 'mode', 'take', 'jokePremise', 'figures'],
              additionalProperties: false,
            },
          },
          close: { type: 'string' },
        },
        required: ['lead', 'dalesStance', 'headlineAngle', 'coldOpenPremise', 'beats', 'close'],
        additionalProperties: false,
      },
    },
  },
  required: ['plans'],
  additionalProperties: false,
}

/**
 * Three plans from the Desk's storylines.
 *
 * The Editor sees the rows the Desk cited (a slice), not the whole pack: the
 * Desk's job was to choose, and handing the Editor everything again would let
 * it un-choose. Grounding is still checked against the full pack.
 */
export async function runEditor(
  facts: GazetteFacts,
  desk: DeskOutput,
  priorThreads: Thread[],
  recentLeads: RecentLead[],
): Promise<EditorOutput> {
  const user = {
    genre: facts.genre,
    weekLabel: facts.weekLabel,
    phase: facts.phase,
    storylines: desk.storylines,
    stale: desk.stale,
    evidence: sliceFacts(facts, desk.storylines.flatMap((s) => s.evidence)),
    priorThreads,
    recentLeads,
  }
  return validated<EditorOutput>(
    'editor',
    (followUps) =>
      callJson<EditorOutput>({
        stage: 'editor',
        system: EDITOR_PROMPT,
        user,
        followUps,
        schema: EDITOR_SCHEMA,
        effort: 'high',
      }),
    (out) => validatePlans(out, desk, facts, recentLeads),
  )
}

export function showPlans(out: EditorOutput) {
  console.log(`\n  EDITOR (v${EDITOR_VERSION})`)
  out.plans.forEach((p, i) => {
    console.log(`\n  PLAN ${i + 1} — lead: ${p.lead}`)
    console.log(`    stance:    ${p.dalesStance}`)
    console.log(`    headline:  ${p.headlineAngle}`)
    console.log(`    cold open: ${p.coldOpenPremise}`)
    p.beats.forEach((b, j) => {
      console.log(`    ${j + 1}. [${b.mode}] ${b.storylineId}: ${b.take}`)
      console.log(`         joke: ${b.jokePremise}${b.figures.length ? `  {${b.figures.join(', ')}}` : ''}`)
    })
    console.log(`    close:     ${p.close}`)
  })
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

const THREADS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      kind: { type: 'string', enum: ['bit', 'thesis', 'callback', 'arc'] },
      note: { type: 'string' },
    },
    required: ['id', 'kind', 'note'],
    additionalProperties: false,
  },
}

const WRITER_SCHEMA = {
  type: 'object',
  properties: {
    issueTitle: { type: 'string' },
    lens: { type: 'string' },
    headline: { type: 'string' },
    deck: { type: 'string' },
    column: { type: 'string' },
    threads: THREADS_SCHEMA,
  },
  required: ['issueTitle', 'lens', 'headline', 'deck', 'column', 'threads'],
  additionalProperties: false,
}

/** What a writer filed, with what the checks found. */
export interface WrittenDraft {
  planIndex: number
  draft: Draft
  /** True when the first attempt failed the gate and this is the one repair. */
  repaired: boolean
  /** Warn-only findings, for a human: misattributions and banned phrases. */
  flagged: { misattributed: string[]; banned: string[] }
}

export interface FailedDraft {
  planIndex: number
  error: string
}

/**
 * Generate, check against the FULL pack, and give the model exactly one chance
 * to fix its own numbers. Throws if the repair still fails.
 *
 * Generalised from write() in gazette.ts, and the repair message keeps its one
 * hard-won rule: it restates what the edition is FOR. A message that says only
 * "fix these numbers" gets an edition optimised for grounding -- a safe
 * manager-by-manager recital -- and week 11 of 2025 was written that way.
 */
export async function writeGrounded<T>(
  stage: string,
  call: (followUps: string[]) => Promise<T>,
  prose: (out: T) => string,
  facts: GazetteFacts,
  purpose: string,
): Promise<{ out: T; repaired: boolean }> {
  let out = await call([])
  let flags = ungroundedNumbers(prose(out), facts)
  if (!flags.length) return { out, repaired: false }

  console.log(`  · ${stage}: ${flags.length} figure(s) not in the pack — asking for a rewrite`)
  for (const f of flags) console.log(`      ${f}`)
  out = await call([
    'These figures in your draft do not appear in the fact pack:\n' +
      flags.map((f) => `  ${f}`).join('\n') +
      '\nRewrite it using only figures from the pack, and do not compute totals. Write a score as ' +
      `130 to 106, never with a hyphen. ${purpose}`,
  ])
  flags = ungroundedNumbers(prose(out), facts)
  if (flags.length) throw new Error(`still ungrounded after a rewrite:\n${flags.map((f) => `  ${f}`).join('\n')}`)
  return { out, repaired: true }
}

const WRITER_PURPOSE =
  'Everything else about the plan still stands. This is a rewrite, not a retreat: keep the stance, ' +
  'keep the weighting uneven, keep the jokes, and do not fall back on a paragraph per manager. ' +
  'Losing the argument to save the arithmetic is a worse column than the one you just filed.'

/** One Writer on one plan. */
async function writeOne(
  facts: GazetteFacts,
  desk: DeskOutput,
  plan: Plan,
  planIndex: number,
  priorThreads: Thread[],
  priorColumns: string[],
): Promise<WrittenDraft> {
  const used = new Set([plan.lead, ...plan.beats.map((b) => b.storylineId)])
  const user = {
    plan,
    storylines: desk.storylines.filter((s) => used.has(s.id)),
    facts: sliceFacts(facts, planPaths(plan, desk)),
    priorThreads,
    priorColumns,
    dalesFirstIssue: isDalesFirstIssue(priorThreads),
  }
  const stage = `writer ${planIndex + 1}`
  const { out, repaired } = await writeGrounded<Draft>(
    stage,
    async (followUps) =>
      cleanDraft(
        await callJson<Draft>({
          stage,
          system: WRITER_PROMPT,
          user,
          followUps,
          schema: WRITER_SCHEMA,
          effort: 'high',
        }),
      ),
    draftProse,
    facts,
    WRITER_PURPOSE,
  )
  const prose = draftProse(out)
  return {
    planIndex,
    draft: out,
    repaired,
    flagged: { misattributed: misattributedNumbers(prose, facts), banned: bannedPhrases(prose) },
  }
}

/**
 * Three Writers in parallel, one per plan. A draft that still fails the gate
 * after its repair is DROPPED, not fatal: the issue fails only if all three do.
 */
export async function runWriters(
  facts: GazetteFacts,
  desk: DeskOutput,
  editor: EditorOutput,
  priorThreads: Thread[],
  priorColumns: string[],
): Promise<{ drafts: WrittenDraft[]; failed: FailedDraft[] }> {
  const settled = await Promise.allSettled(
    editor.plans.map((plan, i) => writeOne(facts, desk, plan, i, priorThreads, priorColumns)),
  )
  const drafts: WrittenDraft[] = []
  const failed: FailedDraft[] = []
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') drafts.push(r.value)
    else failed.push({ planIndex: i, error: r.reason instanceof Error ? r.reason.message : String(r.reason) })
  })
  for (const f of failed) console.log(`  ✗ writer ${f.planIndex + 1} dropped: ${f.error}`)
  if (!drafts.length) throw new Error('every writer failed the grounding gate; nothing to judge')
  return { drafts, failed }
}

export function showDraft(w: WrittenDraft, heading = `DRAFT from plan ${w.planIndex + 1}`) {
  const d = w.draft
  console.log(`\n  ${'═'.repeat(70)}\n  ${heading}${w.repaired ? '  (repaired once)' : ''}`)
  console.log(`  "${d.issueTitle}"  [${d.lens}]\n`)
  console.log(d.headline.toUpperCase())
  console.log(`${d.deck}\n`)
  console.log(d.column)
  if (w.flagged.misattributed.length) {
    console.log('\n  ⚠ possible misattribution, worth a read:')
    for (const m of w.flagged.misattributed) console.log(`      ${m}`)
  }
  if (w.flagged.banned.length) console.log(`\n  ⚠ banned phrases: ${w.flagged.banned.join(', ')}`)
  console.log("\n  Dale's notebook:")
  for (const t of d.threads) console.log(`    [${(t.kind ?? 'bit').padEnd(8)}] ${t.id}: ${t.note}`)
}

// ---------------------------------------------------------------------------
// Judge
// ---------------------------------------------------------------------------

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    ranking: STRING_ARRAY,
    winner: { type: 'string' },
    reasons: { type: 'string' },
    flaggedLines: {
      type: 'array',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, line: { type: 'string' }, why: { type: 'string' } },
        required: ['label', 'line', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['ranking', 'winner', 'reasons', 'flaggedLines'],
  additionalProperties: false,
}

/** A surviving draft under its blind label. */
export interface LabelledDraft extends WrittenDraft {
  label: string
}

/**
 * Blind-label the survivors with the week's seed and ask the Judge to rank
 * them. It sees the prose only: no plan, no plan index, no notebook. With one
 * survivor there is nothing to judge and no call is made.
 */
export async function runJudge(
  facts: GazetteFacts,
  drafts: WrittenDraft[],
): Promise<{ labelled: LabelledDraft[]; verdict: Verdict }> {
  const labelled = blindLabels(drafts, judgeSeed(facts.season, facts.week)).map(({ label, item }) => ({
    ...item,
    label,
  }))
  if (labelled.length === 1) return { labelled, verdict: onlySurvivor(labelled[0].label) }

  const labels = labelled.map((d) => d.label)
  const user = {
    weekLabel: facts.weekLabel,
    drafts: labelled.map((d) => ({
      label: d.label,
      issueTitle: d.draft.issueTitle,
      headline: d.draft.headline,
      deck: d.draft.deck,
      column: d.draft.column,
    })),
  }
  const verdict = await validated<Verdict>(
    'judge',
    (followUps) =>
      callJson<Verdict>({
        stage: 'judge',
        system: JUDGE_PROMPT,
        user,
        followUps,
        schema: JUDGE_SCHEMA,
        effort: 'high',
      }),
    (v) => validateVerdict(v, labels),
  )
  return { labelled, verdict }
}

// ---------------------------------------------------------------------------
// Game notes
// ---------------------------------------------------------------------------

const GAMENOTES_SCHEMA = {
  type: 'object',
  properties: { gameNotes: STRING_ARRAY },
  required: ['gameNotes'],
  additionalProperties: false,
}

/**
 * The plain record, one note per game. Its own small call, its own one-retry
 * shape check, and the same grounding gate with one repair.
 */
export async function runGameNotes(facts: GazetteFacts): Promise<string[]> {
  if (!facts.games.length) return []
  const user = { games: facts.games, rosters: facts.rosters ?? [] }
  const call = (followUps: string[]) =>
    callJson<{ gameNotes: string[] }>({
      stage: 'game notes',
      system: GAMENOTES_PROMPT,
      user,
      followUps,
      schema: GAMENOTES_SCHEMA,
      effort: 'low',
      maxTokens: 8000,
    }).then((r) => r.gameNotes.map(stripMarkup))
  const { out } = await writeGrounded(
    'game notes',
    (followUps) =>
      validated<string[]>(
        'game notes',
        (more) => call([...followUps, ...more]),
        (notes) => validateGameNotes(notes, facts.games.length),
      ),
    (notes) => notes.join('\n\n'),
    facts,
    'One plain note per game, in order, as before.',
  )
  return out
}

// ---------------------------------------------------------------------------
// The whole room
// ---------------------------------------------------------------------------

/** What an issue written by the pipeline is, and everything the room did to get there. */
export interface PipelineRun {
  versions: typeof PIPELINE_VERSIONS
  storylines: DeskOutput['storylines']
  stale: DeskOutput['stale']
  plans: Plan[]
  drafts: Array<{
    label: string
    planIndex: number
    issue: Draft
    flagged: WrittenDraft['flagged']
    repaired: boolean
  }>
  /** Plans whose Writer failed the gate twice. Not judged, kept for the record. */
  dropped: FailedDraft[]
  verdict: Verdict
  /** The winning plan's lead storyline, and who it was about: next week's rotation reads this. */
  lead: { storylineId: string; managers: string[] }
}

/** The finished edition: the winner's prose and notebook, and the separate game notes. */
export interface PipelineIssue extends Draft {
  gameNotes: string[]
}

/**
 * Desk -> Editor -> three Writers -> Judge, and the game notes alongside.
 *
 * The final prose (headline, deck, column, game notes) is gated against the
 * full pack once more after assembly. Each piece already passed on its own, so
 * this cannot fail today; it is here so that the publish gate is a property of
 * what is published rather than of how the pieces happened to be checked.
 */
export async function runPipeline(
  facts: GazetteFacts,
  recentLeads: RecentLead[],
  log: { desk?: boolean; plans?: boolean; drafts?: boolean } = {},
): Promise<{ issue: PipelineIssue; run: PipelineRun }> {
  const priorThreads = facts.priorThreads
  const desk = await runDesk(facts, priorThreads, recentLeads)
  if (log.desk) showDesk(desk)
  const editor = await runEditor(facts, desk, priorThreads, recentLeads)
  if (log.plans) showPlans(editor)

  // The game notes do not depend on any of the room's choices, so they run
  // beside the Writers rather than after the Judge.
  const [{ drafts, failed }, gameNotes] = await Promise.all([
    runWriters(facts, desk, editor, priorThreads, facts.priorColumns),
    runGameNotes(facts),
  ])
  const { labelled, verdict } = await runJudge(facts, drafts)
  if (log.drafts) for (const d of labelled) showDraft(d, `DRAFT ${d.label} (plan ${d.planIndex + 1})`)

  const winner = labelled.find((d) => d.label === verdict.winner)!
  const issue: PipelineIssue = { ...winner.draft, gameNotes }
  const prose = [issue.headline, issue.deck, issue.column, ...issue.gameNotes].join('\n\n')
  const flags = ungroundedNumbers(prose, facts)
  if (flags.length) throw new Error(`the assembled edition is ungrounded:\n${flags.map((f) => `  ${f}`).join('\n')}`)

  const leadPlan = editor.plans[winner.planIndex]
  const leadStory = desk.storylines.find((s) => s.id === leadPlan.lead)!
  return {
    issue,
    run: {
      versions: PIPELINE_VERSIONS,
      storylines: desk.storylines,
      stale: desk.stale,
      plans: editor.plans,
      drafts: labelled.map((d) => ({
        label: d.label,
        planIndex: d.planIndex,
        issue: d.draft,
        flagged: d.flagged,
        repaired: d.repaired,
      })),
      dropped: failed,
      verdict,
      lead: { storylineId: leadStory.id, managers: leadStory.managers },
    },
  }
}

export function showVerdict(run: PipelineRun) {
  const v = run.verdict
  const w = run.drafts.find((d) => d.label === v.winner)!
  console.log(`\n  JUDGE (v${JUDGE_VERSION}) — ranking ${v.ranking.join(' > ')}; winner ${v.winner} (plan ${w.planIndex + 1}, lead ${run.lead.storylineId})`)
  console.log(`    ${v.reasons}`)
  for (const f of v.flaggedLines) console.log(`    flag [${f.label}] "${f.line}" — ${f.why}`)
  for (const d of run.dropped) console.log(`    dropped: plan ${d.planIndex + 1} (${d.error.split('\n')[0]})`)
}

export const PIPELINE_VERSIONS = {
  desk: DESK_VERSION,
  editor: EDITOR_VERSION,
  voice: VOICE_VERSION,
  writer: WRITER_VERSION,
  judge: JUDGE_VERSION,
  gameNotes: GAMENOTES_VERSION,
}
