/**
 * Refuse to run destructive tests while anyone is connected to the draft.
 *
 * Integration tests reset draft state AND rely on lots not settling underneath
 * them. A single open browser tab polls /api/state every 400ms, and that poll
 * settles expired lots — which silently breaks tests and, far worse, would let
 * a test wipe a draft people are actually using.
 *
 * Detection: write a sentinel expired lot's worth of state? No — simpler and
 * safer. We watch `draft.rev` and the pick count for a moment; if anything
 * moves, someone is live. We also probe the local dev server, which is the
 * usual source of polling during development.
 */
import { neon } from '@neondatabase/serverless'
import '../src/db/neon-local'

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000'

async function main() {
  if (process.env.SKIP_IDLE_CHECK === '1') {
    console.log('⚠️  idle check skipped (SKIP_IDLE_CHECK=1)')
    return
  }

  const sql = neon(process.env.DATABASE_URL!)

  // If a draft is genuinely under way, refuse outright — this is the check that
  // matters on draft night.
  //
  // Scoped to the current season: archived picks are permanent, so an unscoped
  // count would sit at 160+ forever and block the destructive suites for good
  // once a season is in the books.
  const [settings] = await sql`SELECT season, status FROM draft WHERE id = 1`
  const [{ n: picks }] =
    await sql`SELECT count(*)::int AS n FROM picks WHERE season = ${settings.season}`
  if (Number(picks) > 0 && settings.status !== 'setup') {
    fail(
      `There are ${picks} picks in season ${settings.season} and the draft is "${settings.status}".\n` +
        `   This looks like a REAL DRAFT. Refusing to wipe it.`,
    )
  }

  // A dev server that answers is usually one with a browser attached to it.
  try {
    const res = await fetch(`${BASE}/api/state`, { signal: AbortSignal.timeout(1500) })
    if (res.ok || res.status === 204) {
      console.warn(
        `⚠️  A server is responding at ${BASE}.\n` +
          `   Any open browser tab polls /api/state every 400ms and will settle\n` +
          `   expired lots underneath these tests. Stop the dev server first.`,
      )
      process.exitCode = 1
      return
    }
  } catch {
    // Nothing listening — good.
  }

  console.log('✓ nobody connected; safe to run destructive tests')
}

function fail(msg: string) {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
