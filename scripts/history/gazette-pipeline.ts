/**
 * The Gazette's editorial room: the model-calling half.
 *
 *   weekInReview() pack
 *     -> Story Desk   storylines, each citing pack paths       (gazette-room/desk-prompt.ts)
 *     -> Editor       three plans, distinct leads               (gazette-room/editor-prompt.ts)
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
import { pathIndex, sliceFacts, type GazetteFacts, type Thread } from '../../src/lib/gazette'
import {
  BEAT_MODES,
  repairNote,
  validateDesk,
  validatePlans,
  type DeskOutput,
  type EditorOutput,
  type RecentLead,
} from '../../src/lib/gazette-room'
import { callJson } from './gazette-model'
import { DESK_PROMPT, DESK_VERSION } from './gazette-room/desk-prompt'
import { EDITOR_PROMPT, EDITOR_VERSION } from './gazette-room/editor-prompt'

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

export const PIPELINE_VERSIONS = { desk: DESK_VERSION, editor: EDITOR_VERSION }
