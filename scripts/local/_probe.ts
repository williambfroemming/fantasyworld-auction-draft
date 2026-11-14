import { getSql } from '../../src/server/sql'
const sql = getSql()
const a = await sql`SELECT season, count(DISTINCT week)::int w FROM season_matchups WHERE season >= 2025 GROUP BY season`
const b = await sql`SELECT season, week, prompt_version FROM week_issues ORDER BY season, week`
console.log(a, b.map((r) => `${r.season}/${r.week}v${r.prompt_version}`).join(' '))
