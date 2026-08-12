/**
 * End-to-end smoke test through the real HTTP layer.
 *
 * Drives an actual draft against a running dev server: sign in, nominate, bid,
 * outbid, let the clock expire, confirm the roster and budget moved. This is
 * the check that the unit and integration suites cannot make — it exercises
 * cookies, route handlers, caching headers, and JSON shapes together.
 *
 *   npm run dev            # in one terminal
 *   npm run smoke          # in another
 *
 * ⚠️ Resets draft state. Guarded by ALLOW_DB_RESET=1 like the integration tests.
 */
import { neon } from '@neondatabase/serverless'

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000'
let failures = 0

function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

/** Minimal cookie jar so the session survives across requests. */
const jar = new Map<string, string>()
async function http(path: string, init: RequestInit = {}) {
  const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  })
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';')
    const idx = pair.indexOf('=')
    jar.set(pair.slice(0, idx), pair.slice(idx + 1))
  }
  const text = await res.text()
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null }
}

async function main() {
  if (process.env.ALLOW_DB_RESET !== '1') {
    throw new Error('Refusing to run without ALLOW_DB_RESET=1 (this wipes draft state).')
  }
  const sql = neon(process.env.DATABASE_URL!)
  await sql`DELETE FROM bids`
  await sql`DELETE FROM picks`
  await sql`DELETE FROM lots`
  await sql`UPDATE draft SET status='live', nomination_index=0, rev=0,
            timer_seconds=25, soft_close_seconds=10 WHERE id=1`
  console.log('reset draft to live\n')

  // --- pages -------------------------------------------------------------
  for (const p of ['/', '/draft']) {
    const res = await fetch(`${BASE}${p}`)
    check(`GET ${p} renders`, res.ok, `HTTP ${res.status}`)
  }

  // --- state + caching ----------------------------------------------------
  const s0 = await http('/api/state')
  check('GET /api/state returns 10 managers', s0.body?.managers?.length === 10)
  check(
    '/api/state is uncacheable (would freeze the draft if cached)',
    /no-store/.test(s0.headers.get('cache-control') ?? ''),
    s0.headers.get('cache-control') ?? 'missing',
  )
  check('everyone starts at $200 / max $185',
    s0.body.managers.every((m: { budget: number; maxBid: number }) => m.budget === 200 && m.maxBid === 185))

  const unchanged = await http(`/api/state?v=${encodeURIComponent(s0.body.version)}`)
  check('unchanged version short-circuits to 204', unchanged.status === 204)

  // --- auth ---------------------------------------------------------------
  const clockId: number = s0.body.onTheClock.managerId
  const clockName = s0.body.managers.find((m: { id: number }) => m.id === clockId).displayName

  const anon = await http('/api/nominate', {
    method: 'POST',
    body: JSON.stringify({ playerId: 'x', openingBid: 1 }),
  })
  check('anonymous nomination is rejected', anon.status === 401)

  await sql`UPDATE managers SET pin_hash = NULL WHERE id = ${clockId}` // fresh claim
  const login = await http('/api/session', {
    method: 'POST',
    body: JSON.stringify({ managerId: clockId, pin: '1234' }),
  })
  check(`signed in as ${clockName}`, login.body?.ok === true)

  const badPin = await http('/api/session', {
    method: 'POST',
    body: JSON.stringify({ managerId: clockId, pin: '9999' }),
  })
  check('wrong PIN is rejected', badPin.status === 401)

  // --- nominate -----------------------------------------------------------
  const board = await http('/api/board')
  const top = board.body.pool[0]
  check(`board leads with a ranked player (${top.name})`, top.rank === 1)

  const nom = await http('/api/nominate', {
    method: 'POST',
    body: JSON.stringify({ playerId: top.id, openingBid: 10 }),
  })
  check(`nominated ${top.name} at $10`, nom.body?.ok === true, nom.body?.reason ?? '')

  const s1 = await http('/api/state')
  check('nominator is the standing high bidder', s1.body.lot?.highBidderId === clockId)
  check('version changed after the nomination', s1.body.version !== s0.body.version)

  const board2 = await http('/api/board')
  check(
    'nominated player left the pool immediately',
    !board2.body.pool.some((p: { id: string }) => p.id === top.id),
  )

  // --- bidding ------------------------------------------------------------
  const lotId = s1.body.lot.id
  const other = s0.body.managers.find((m: { id: number }) => m.id !== clockId)
  await sql`UPDATE managers SET pin_hash = NULL WHERE id = ${other.id}`
  await http('/api/session', {
    method: 'POST',
    body: JSON.stringify({ managerId: other.id, pin: '4321' }),
  })

  const low = await http('/api/bid', { method: 'POST', body: JSON.stringify({ lotId, amount: 10 }) })
  check('a bid that does not beat the current bid is rejected', low.body?.ok === false,
    low.body?.reason)

  const over = await http('/api/bid', { method: 'POST', body: JSON.stringify({ lotId, amount: 999 }) })
  check('a bid over max is rejected with a readable reason', over.body?.ok === false, over.body?.reason)
  check('the rejection explains the max-bid rule', /max bid/i.test(over.body?.reason ?? ''))

  const good = await http('/api/bid', { method: 'POST', body: JSON.stringify({ lotId, amount: 25 }) })
  check(`${other.displayName} bid $25`, good.body?.ok === true, good.body?.reason ?? '')

  // --- soft close ---------------------------------------------------------
  await sql`UPDATE lots SET ends_at = now() + interval '2 seconds' WHERE id=${lotId}`
  await http('/api/bid', { method: 'POST', body: JSON.stringify({ lotId, amount: 26 }) })
  const [{ ms }] = await sql`
    SELECT EXTRACT(EPOCH FROM (ends_at - now())) * 1000 AS ms FROM lots WHERE id=${lotId}`
  check('a bid inside the final 10s pushes the clock back to 10s',
    Number(ms) > 9000 && Number(ms) <= 10_100, `${Math.round(Number(ms))}ms left`)

  // --- settlement ---------------------------------------------------------
  await sql`UPDATE lots SET ends_at = now() - interval '1 second' WHERE id=${lotId}`
  // Ten clients polling at once, exactly as on draft night.
  await Promise.all(Array.from({ length: 10 }, () => http('/api/state')))
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks`
  check('ten concurrent polls settle the lot exactly once', Number(n) === 1, `${n} picks`)

  const s2 = await http('/api/state')
  const winner = s2.body.managers.find((m: { id: number }) => m.id === other.id)
  check('winner rostered the player', winner.rostered === 1)
  check('budget dropped by exactly the price', winner.budget === 200 - 26, `$${winner.budget}`)
  check('max bid recalculated', winner.maxBid === 200 - 26 - 14, `$${winner.maxBid}`)
  check('lot cleared and the next manager is on the clock', s2.body.lot === null && !!s2.body.onTheClock)

  console.log(failures === 0 ? '\nSmoke test passed.' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
