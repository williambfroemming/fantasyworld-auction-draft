/**
 * The text guard in front of the Oracle's SQL (docs/archive/ANALYTICS_ROADMAP.md §A, step 39).
 *
 * This is the THIRD of three layers and the weakest on purpose. The real boundary is
 * Postgres: a NOLOGIN role that can read only the `oracle` views, inside a read-only
 * transaction (scripts/migrate-oracle.ts, src/server/oracle-service.ts). This function
 * exists to give the model a fast, readable refusal and to keep obviously wrong input
 * from ever reaching the database — not to be a SQL parser.
 *
 * It is therefore deliberately blunt and deliberately allowed to over-reject. A
 * semicolon inside a string literal is refused too; the model can rephrase. Do not
 * "improve" it into something cleverer: every clever rule is a new way to be wrong, and
 * nothing here is relied on for safety.
 *
 * Pure: no imports from src/server, no I/O.
 */

/** Rows returned to the model. The wrapper asks for one more so truncation is visible. */
export const ROW_LIMIT = 200

export const MAX_SQL_LENGTH = 4000

/**
 * Whole words only. `\b` treats `_` as a word character, so `created_at`,
 * `injury_updated_at` and `is_final` are not caught by `create`, `update` and friends.
 */
const FORBIDDEN_WORDS =
  /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke|copy|call)\b/i

/** Substrings, not words: `pg_catalog`, `pg_sleep`, `information_schema`, `public.x`. */
const FORBIDDEN_FRAGMENTS = /pg_|information_schema|set_config|public\./i

export type GuardResult = { ok: true; sql: string } | { ok: false; reason: string }

export function guardSql(input: string): GuardResult {
  let text = input.trim()
  if (text.endsWith(';')) text = text.slice(0, -1).trim()

  if (text === '') return refuse('The query is empty.')
  if (text.length > MAX_SQL_LENGTH) {
    return refuse(`The query is longer than ${MAX_SQL_LENGTH} characters.`)
  }
  if (text.includes(';')) {
    return refuse('Only one statement is allowed, and a semicolon appears inside it.')
  }
  if (text.includes('--') || text.includes('/*')) {
    return refuse('Comments (-- and /* */) are not allowed.')
  }
  if (!/^(select|with)\b/i.test(text)) {
    return refuse('The query must start with SELECT or WITH.')
  }

  const word = FORBIDDEN_WORDS.exec(text)
  if (word) return refuse(`The word "${word[1].toLowerCase()}" is not allowed.`)

  const fragment = FORBIDDEN_FRAGMENTS.exec(text)
  if (fragment) {
    return refuse(
      `"${fragment[0].toLowerCase()}" is not allowed. Query only the views in the oracle schema, by bare name.`,
    )
  }

  return { ok: true, sql: `SELECT * FROM (${text}) AS oracle_q LIMIT ${ROW_LIMIT + 1}` }
}

function refuse(reason: string): GuardResult {
  return { ok: false, reason }
}
