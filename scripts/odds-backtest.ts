/**
 * Score the playoff odds against every finished season. Read-only.
 *
 *   npm run odds:backtest
 *
 * Run it every offseason, once the new season has its champion. See
 * `src/lib/playoff-backtest.ts` for what the numbers mean and why the history
 * is scored leave-one-season-out.
 */
import 'dotenv/config'
import { getSql } from '../src/server/sql'
import { getHistoryInput } from '../src/server/history-service'
import { backtest, CHECKPOINTS } from '../src/lib/playoff-backtest'

async function main() {
  const sql = getSql()
  const [input, rows] = await Promise.all([
    getHistoryInput(),
    sql`SELECT season, playoff_teams FROM seasons WHERE playoff_teams IS NOT NULL`,
  ])
  const playoffTeams = new Map(rows.map((r) => [Number(r.season), Number(r.playoff_teams)]))

  const result = backtest({ ...input, playoffTeams })
  if (!result) {
    console.log('\nNo finished season with weekly results to test against.\n')
    return
  }

  const pct = (n: number) => `${Math.round(n * 100)}%`
  console.log(
    `\nPlayoff odds vs what happened · ${result.seasons.join(', ')}` +
      `\n${result.predictions} predictions, after weeks ${CHECKPOINTS.join(', ')}\n`,
  )
  console.log('When the model said…   it happened')
  for (const b of result.buckets) {
    console.log(
      `  ${b.label.padEnd(9)} (avg ${pct(b.predicted).padStart(4)})   ${pct(b.actual).padStart(4)}   n=${b.teams}`,
    )
  }

  const { model, history, baseline } = result.brier
  console.log('\nError (Brier score, lower is better)')
  console.log(`  model                           ${model.toFixed(3)}`)
  console.log(`  record-by-week history          ${history.toFixed(3)}   (leave-one-season-out)`)
  console.log(`  "${pct(result.baseRate)} for everyone"                ${baseline.toFixed(3)}`)
  console.log(
    history < model
      ? '\n→ The history is now beating the model. Worth folding it in — see BACKLOG.\n'
      : '\n→ The model still beats the history on its own. Keep them separate.\n',
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
