import { ORACLE_RULES, oracleSchemaText } from '@/lib/oracle-schema'
import { ROW_LIMIT, guardSql } from '@/lib/oracle-sql'
import { getSql } from './sql'

/**
 * Runs one untrusted SQL string for the Oracle (docs/archive/ANALYTICS_ROADMAP.md §A, step 39).
 *
 * Three layers, all required, and this file is where the second and third meet:
 *   1. `guardSql` — a blunt text filter that produces readable refusals.
 *   2. One Neon HTTP batch with `readOnly: true`, so the transaction itself refuses writes.
 *   3. `SET LOCAL ROLE oracle_reader` as the batch's first statement, so Postgres decides
 *      what is reachable: only the views in the `oracle` schema, nothing in `public`.
 *
 * Layer 3 is the one that matters. If the guard has a hole, this still cannot read
 * `player_queue` or `managers.pin_hash`; see scripts/migrate-oracle.ts.
 *
 * ## Contract: this function never throws
 *
 * A database error comes back as `{ ok: false, reason }` carrying Postgres's own
 * message, because the model needs the message to repair its SQL. Do not paraphrase it.
 * Do not match on its wording either — it differs between local Postgres and Neon
 * ("permission denied for schema public" versus "…for table player_queue").
 *
 * ## Values
 *
 * `numeric` columns come back from Neon as strings, so every points column here is a
 * string. That is fine for a model reading rows, and wrong to do arithmetic on.
 *
 * ## Not on any polling path
 *
 * This is the one outbound-adjacent query path with an unbounded author, and it is
 * allowed only because nothing polls it. It must stay off /api/state and out of
 * src/lib/version.ts.
 */

export type OracleQueryResult =
  | { ok: true; columns: string[]; rows: unknown[][]; truncated: boolean; ms: number }
  | { ok: false; reason: string }

/** Milliseconds the database may spend on one query before it is cancelled. */
export const STATEMENT_TIMEOUT_MS = 3000

export async function runOracleQuery(input: string): Promise<OracleQueryResult> {
  const guarded = guardSql(input)
  if (!guarded.ok) return { ok: false, reason: guarded.reason }

  const started = Date.now()
  try {
    const sql = getSql()
    const results = await sql.transaction(
      [
        sql.query('SET LOCAL ROLE oracle_reader'),
        sql.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`),
        sql.query('SET LOCAL search_path = oracle'),
        sql.query(guarded.sql),
      ],
      // arrayMode keeps duplicate column names (SELECT a.x, b.x) from collapsing.
      { readOnly: true, fullResults: true, arrayMode: true },
    )

    const last = results[results.length - 1] as unknown as {
      fields: Array<{ name: string }>
      rows: unknown[][]
    }
    const truncated = last.rows.length > ROW_LIMIT
    return {
      ok: true,
      columns: last.fields.map((f) => f.name),
      rows: truncated ? last.rows.slice(0, ROW_LIMIT) : last.rows,
      truncated,
      ms: Date.now() - started,
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

// ---------------------------------------------------------------------------
// The tool loop (step 41)
// ---------------------------------------------------------------------------

export const ORACLE_MODEL = 'claude-sonnet-5-5'
export const MAX_STEPS = 5

/** Rows the model is shown from any one result. The page still gets all (up to 200). */
const ROWS_SHOWN_TO_MODEL = 50

/** Per request to the API. The route allows 60s in total. */
const API_TIMEOUT_MS = 40_000

export interface OracleStep {
  sql: string
  ok: boolean
  columns: string[]
  rows: unknown[][]
  truncated: boolean
  error: string | null
  ms: number
}

export interface OracleResult {
  ok: boolean
  answer: string | null
  steps: OracleStep[]
  error: string | null
  inputTokens: number
  outputTokens: number
}

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: { sql?: unknown } }
  | { type: string; [k: string]: unknown }

interface ApiMessage {
  role: 'user' | 'assistant'
  content: string | unknown[]
}

interface ApiResponse {
  stop_reason?: string
  content: Block[]
  usage?: { input_tokens?: number; output_tokens?: number }
}

const TOOLS = [
  {
    name: 'query',
    description: 'Run one read-only SQL SELECT against the league database and get the rows back.',
    input_schema: {
      type: 'object',
      properties: { sql: { type: 'string' } },
      required: ['sql'],
    },
  },
]

/**
 * Answer a question by letting the model write SQL, one query at a time.
 *
 * One tool, `query`; at most MAX_STEPS queries; the model answers from the rows. A plain
 * `fetch` to the Messages API, the same way scripts/history/gazette.ts does it — no SDK,
 * not streamed. Never throws: every failure is an `{ ok: false, error }` result carrying
 * whatever steps were taken, so the log can show how far it got.
 *
 * `run` is injectable only so the loop can be tested without a database; the route always
 * uses the default, which is the guarded read-only runner above.
 */
export async function askOracle(
  question: string,
  run: (sql: string) => Promise<OracleQueryResult> = runOracleQuery,
): Promise<OracleResult> {
  const steps: OracleStep[] = []
  let inputTokens = 0
  let outputTokens = 0
  const fail = (error: string): OracleResult => ({
    ok: false,
    answer: null,
    steps,
    error,
    inputTokens,
    outputTokens,
  })

  const key = process.env.ANTHROPIC_API_KEY?.trim()
  if (!key) return fail('The Oracle is not configured: ANTHROPIC_API_KEY is not set.')

  const system = `${ORACLE_RULES}\n\nThe views:\n\n${oracleSchemaText()}`
  const messages: ApiMessage[] = [{ role: 'user', content: question }]

  // One send per query plus a final one to answer after the last result comes back.
  for (let round = 0; round <= MAX_STEPS; round++) {
    let body: ApiResponse
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: ORACLE_MODEL,
          max_tokens: 2000,
          system,
          tools: TOOLS,
          messages,
        }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      })
      if (!res.ok) return fail(`The Oracle could not reach its model (status ${res.status}).`)
      body = (await res.json()) as ApiResponse
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'TimeoutError'
      return fail(
        timedOut ? 'The Oracle took too long to answer.' : 'The Oracle could not reach its model.',
      )
    }

    inputTokens += body.usage?.input_tokens ?? 0
    outputTokens += body.usage?.output_tokens ?? 0

    if (body.stop_reason === 'refusal') return fail('The Oracle declined to answer that.')

    const toolUses = body.content.filter(
      (b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use',
    )

    if (body.stop_reason !== 'tool_use' || toolUses.length === 0) {
      const answer = body.content
        .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim()
      if (!answer) {
        return fail(
          body.stop_reason === 'max_tokens'
            ? 'The Oracle ran out of room before it finished answering.'
            : 'The Oracle came back with nothing to say.',
        )
      }
      return { ok: true, answer, steps, error: null, inputTokens, outputTokens }
    }

    // The model wants more queries. If it has already had all it is allowed, stop.
    if (steps.length >= MAX_STEPS) {
      return fail('The Oracle could not work that out in five queries.')
    }

    messages.push({ role: 'assistant', content: body.content })

    const results: unknown[] = []
    for (const block of toolUses) {
      if (steps.length >= MAX_STEPS) {
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: 'Query budget used up. Answer from the rows you already have.',
          is_error: true,
        })
        continue
      }
      const sql = typeof block.input?.sql === 'string' ? block.input.sql : ''
      const r = await run(sql)
      if (r.ok) {
        steps.push({
          sql,
          ok: true,
          columns: r.columns,
          rows: r.rows,
          truncated: r.truncated,
          error: null,
          ms: r.ms,
        })
        const shown = r.rows.slice(0, ROWS_SHOWN_TO_MODEL)
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({
            columns: r.columns,
            rows: shown,
            rowCount: r.rows.length,
            ...(r.rows.length > shown.length || r.truncated
              ? {
                  note: r.truncated
                    ? `More than ${r.rows.length} rows matched; you see the first ${shown.length}. Aggregate or filter in SQL instead of reading rows.`
                    : `${r.rows.length} rows matched; you see the first ${shown.length}. Aggregate or filter in SQL instead of reading rows.`,
                }
              : {}),
          }),
        })
      } else {
        steps.push({
          sql,
          ok: false,
          columns: [],
          rows: [],
          truncated: false,
          error: r.reason,
          ms: 0,
        })
        results.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: r.reason,
          is_error: true,
        })
      }
    }
    messages.push({ role: 'user', content: results })
  }

  return fail('The Oracle could not work that out in five queries.')
}

// ---------------------------------------------------------------------------
// The daily cap and the log (step 42)
// ---------------------------------------------------------------------------

/** Questions one manager may ask per rolling 24 hours. Every one costs real money. */
export const DAILY_LIMIT = 30

/** Rows kept per step in oracle_log. Enough to see what the model saw; not the table. */
const LOG_ROWS_PER_STEP = 20

/**
 * How many questions this manager has asked in the last 24 hours, and when the oldest of
 * them ages out (which is when a full allowance starts to free up). One statement.
 *
 * Counts every logged row, failed or not: a question that errored still spent tokens.
 * Scoped by manager_id — one manager's questions never use up another's allowance.
 */
export async function questionsToday(
  managerId: number,
): Promise<{ count: number; freesAt: Date | null }> {
  const sql = getSql()
  const [row] = await sql`
    SELECT count(*)::int AS n, min(created_at) AS oldest
    FROM oracle_log
    WHERE manager_id = ${managerId}
      AND created_at > now() - interval '24 hours'`
  const oldest = row.oldest ? new Date(row.oldest as string) : null
  return {
    count: row.n as number,
    freesAt: oldest ? new Date(oldest.getTime() + 24 * 60 * 60 * 1000) : null,
  }
}

/** Record one question, successful or not. One statement. Returns the new row's id. */
export async function logQuestion(
  managerId: number,
  question: string,
  result: OracleResult,
  ms: number,
): Promise<number> {
  const sql = getSql()
  const steps = result.steps.map((s) => ({ ...s, rows: s.rows.slice(0, LOG_ROWS_PER_STEP) }))
  const [row] = await sql`
    INSERT INTO oracle_log
      (manager_id, question, answer, steps, ok, error, ms, input_tokens, output_tokens)
    VALUES
      (${managerId}, ${question}, ${result.answer}, ${JSON.stringify(steps)}::jsonb,
       ${result.ok}, ${result.error}, ${ms}, ${result.inputTokens}, ${result.outputTokens})
    RETURNING id`
  return row.id as number
}
