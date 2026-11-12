/**
 * The Gazette's editorial room: the model-calling half.
 *
 *   weekInReview() pack
 *     -> Story Desk   storylines, each citing pack paths       (gazette-room/desk-prompt.ts)
 *     -> Editor       three plans, distinct leads               (gazette-room/editor-prompt.ts)
 *     -> Writer x3    one draft per plan, in parallel           (gazette-room/writer-prompt.ts, voice.ts)
 *
 * Further stages arrive in steps 69-71 of docs/GAZETTE_ROADMAP.md. Everything
 * here runs only behind a flag on scripts/history/gazette.ts; the weekly job
 * and the single-pass edition do not touch it.
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

export const PIPELINE_VERSIONS = {
  desk: DESK_VERSION,
  editor: EDITOR_VERSION,
  voice: VOICE_VERSION,
  writer: WRITER_VERSION,
}
