import { ROW_LIMIT, guardSql } from '@/lib/oracle-sql'
import { getSql } from './sql'

/**
 * Runs one untrusted SQL string for the Oracle (docs/ANALYTICS_ROADMAP.md §A, step 39).
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
