/**
 * The Gazette's editorial room: the model-calling half.
 *
 *   weekInReview() pack
 *     -> Story Desk   storylines, each citing pack paths       (gazette-room/desk-prompt.ts)
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
  pathIndex,
  type GazetteFacts,
  type Thread,
} from '../../src/lib/gazette'
import { repairNote, validateDesk, type DeskOutput } from '../../src/lib/gazette-room'
import { callJson } from './gazette-model'
import { DESK_PROMPT, DESK_VERSION } from './gazette-room/desk-prompt'

/** What an earlier issue led with, for the Desk's sense of what is stale. */
export interface RecentLead {
  week: number
  headline: string
  /** Only issues written by the pipeline know their lead storyline. */
  lead?: { storylineId: string; managers: string[] }
}

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

export const PIPELINE_VERSIONS = { desk: DESK_VERSION }
