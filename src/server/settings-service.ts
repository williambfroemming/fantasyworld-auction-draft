import { getSql } from './sql'

/**
 * Commissioner switches stored in `app_settings` (scripts/migrate-access.ts).
 *
 * Absent row = the default, so a new switch needs no data migration and a database that
 * has not been migrated yet behaves as if everything is on. Read per request: these are
 * flipped by hand, rarely, and a cached value would defeat a kill-switch.
 */

const ORACLE_KEY = 'oracle_enabled'

/** Is Ask the Oracle switched on? Defaults to on. */
export async function oracleEnabled(): Promise<boolean> {
  const [row] = await getSql()`SELECT value FROM app_settings WHERE key = ${ORACLE_KEY}`
  return row?.value !== 'false'
}

/** One statement. Records who flipped it and when. */
export async function setOracleEnabled(enabled: boolean, byManagerId: number): Promise<void> {
  await getSql()`
    INSERT INTO app_settings (key, value, updated_by)
    VALUES (${ORACLE_KEY}, ${enabled ? 'true' : 'false'}, ${byManagerId})
    ON CONFLICT (key) DO UPDATE
      SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`
}

/** What the commissioner's panel shows: the switch, and what the Oracle is costing. */
export async function oracleAdminSummary() {
  const sql = getSql()
  const [setting] = await sql`
    SELECT value, updated_at, (SELECT display_name FROM managers WHERE id = updated_by) AS by
    FROM app_settings WHERE key = ${ORACLE_KEY}`
  const [u] = await sql`
    SELECT
      count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS q24,
      count(*)::int AS q_total,
      coalesce(sum(input_tokens)  FILTER (WHERE created_at > now() - interval '24 hours'), 0)::int AS in24,
      coalesce(sum(output_tokens) FILTER (WHERE created_at > now() - interval '24 hours'), 0)::int AS out24,
      coalesce(sum(input_tokens), 0)::int AS in_total,
      coalesce(sum(output_tokens), 0)::int AS out_total
    FROM oracle_log`
  const top = await sql`
    SELECT m.display_name AS name, count(*)::int AS n
    FROM oracle_log l JOIN managers m ON m.id = l.manager_id
    WHERE l.created_at > now() - interval '24 hours'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 5`
  return {
    enabled: setting?.value !== 'false',
    changedAt: (setting?.updated_at as string | undefined) ?? null,
    changedBy: (setting?.by as string | null | undefined) ?? null,
    last24h: { questions: u.q24 as number, inputTokens: u.in24 as number, outputTokens: u.out24 as number },
    allTime: { questions: u.q_total as number, inputTokens: u.in_total as number, outputTokens: u.out_total as number },
    topAskers24h: top.map((r) => ({ name: r.name as string, questions: r.n as number })),
  }
}
