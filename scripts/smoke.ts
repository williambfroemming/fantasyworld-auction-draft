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
  await sql`DELETE FROM budget_adjustments`
  await sql`DELETE FROM trades`
  await sql`DELETE FROM picks`
  await sql`DELETE FROM lots`
  await sql`UPDATE draft SET status='live', nomination_index=0, rev=0 WHERE id=1`
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
    body: JSON.stringify({ playerId: 'x' }),
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
    body: JSON.stringify({ playerId: top.id }),
  })
  check(`nominated ${top.name}`, nom.body?.ok === true, nom.body?.reason ?? '')

  const s1 = await http('/api/state')
  check('the lot opens with no price and no winner', s1.body.lot?.id > 0)
  check('version changed after the nomination', s1.body.version !== s0.body.version)

  const board2 = await http('/api/board')
  check(
    'nominated player left the pool immediately',
    !board2.body.pool.some((p: { id: string }) => p.id === top.id),
  )

  // --- awarding -----------------------------------------------------------
  const lotId = s1.body.lot.id
  const other = s0.body.managers.find((m: { id: number }) => m.id !== clockId)

  const over = await http('/api/award', {
    method: 'POST',
    body: JSON.stringify({ lotId, winnerId: other.id, price: 999 }),
  })
  check('a price over max is rejected with a readable reason', over.body?.ok === false, over.body?.reason)
  check('the rejection explains the max-bid rule', /max bid/i.test(over.body?.reason ?? ''))

  const zero = await http('/api/award', {
    method: 'POST',
    body: JSON.stringify({ lotId, winnerId: other.id, price: 0 }),
  })
  check('$0 is rejected — every player costs at least $1', zero.status === 400 || zero.body?.ok === false)

  // A stranger cannot record someone else's lot. Sign in as `other`, who is
  // neither the nominator nor (necessarily) the commissioner.
  await sql`UPDATE managers SET pin_hash = NULL WHERE id = ${other.id}`
  await http('/api/session', {
    method: 'POST',
    body: JSON.stringify({ managerId: other.id, pin: '4321' }),
  })
  const [{ is_commish: otherIsCommish }] =
    await sql`SELECT is_commish FROM managers WHERE id = ${other.id}`
  if (!otherIsCommish) {
    const stranger = await http('/api/award', {
      method: 'POST',
      body: JSON.stringify({ lotId, winnerId: other.id, price: 26 }),
    })
    check('only the nominator or commissioner can record the sale',
      stranger.body?.ok === false, stranger.body?.reason)
  }

  // Back to the nominator, who actually ran the bidding.
  await http('/api/session', {
    method: 'POST',
    body: JSON.stringify({ managerId: clockId, pin: '1234' }),
  })

  // Ten simultaneous recordings — an impatient double-tap on a laggy phone.
  const races = await Promise.all(
    Array.from({ length: 10 }, () =>
      http('/api/award', {
        method: 'POST',
        body: JSON.stringify({ lotId, winnerId: other.id, price: 26 }),
      }),
    ),
  )
  check('ten concurrent awards sell the player exactly once',
    races.filter((r) => r.body?.ok).length === 1,
    `${races.filter((r) => r.body?.ok).length} accepted`)

  const [{ n }] = await sql`SELECT count(*)::int AS n FROM picks`
  check('exactly one pick was written', Number(n) === 1, `${n} picks`)

  const s2 = await http('/api/state')
  const winner = s2.body.managers.find((m: { id: number }) => m.id === other.id)
  check('winner rostered the player', winner.rostered === 1)
  check('budget dropped by exactly the price', winner.budget === 200 - 26, `$${winner.budget}`)
  check('max bid recalculated', winner.maxBid === 200 - 26 - 14, `$${winner.maxBid}`)
  check('lot cleared and the next manager is on the clock', s2.body.lot === null && !!s2.body.onTheClock)

  // --- trades -------------------------------------------------------------
  const [pickRow] = await sql`SELECT id FROM picks ORDER BY pick_no DESC LIMIT 1`
  const trade = await http('/api/trade', {
    method: 'POST',
    body: JSON.stringify({
      aId: other.id,
      bId: clockId,
      picksAToB: [Number(pickRow.id)],
      picksBToA: [],
      cashAToB: 0,
      cashBToA: 15,
    }),
  })
  check('a trade of a player plus cash is accepted', trade.body?.ok === true, trade.body?.reason ?? '')

  const s3 = await http('/api/state')
  const a3 = s3.body.managers.find((m: { id: number }) => m.id === other.id)
  const b3 = s3.body.managers.find((m: { id: number }) => m.id === clockId)
  // Salary stays with the drafter, so only the $15 moves.
  check('the traded salary stayed with the drafter', a3.budget === 200 - 26 + 15, `$${a3.budget}`)
  check('the cash moved to the other side', b3.budget === 200 - 15, `$${b3.budget}`)
  check('the player moved rosters', a3.rostered === 0 && b3.rostered === 1)
  check('the trade changed the polling version', s3.body.version !== s2.body.version)

  const [{ total }] = await sql`SELECT COALESCE(SUM(amount),0)::int AS total FROM budget_adjustments`
  check('trade adjustments sum to zero across the league', Number(total) === 0, `sum = ${total}`)

  const broke = await http('/api/trade', {
    method: 'POST',
    body: JSON.stringify({
      aId: other.id, bId: clockId, picksAToB: [], picksBToA: [], cashAToB: 999, cashBToA: 0,
    }),
  })
  check('a trade that would strand a manager is refused', broke.body?.ok === false, broke.body?.reason)

  const [{ total: total2 }] = await sql`SELECT COALESCE(SUM(amount),0)::int AS total FROM budget_adjustments`
  check('the refused trade wrote nothing', Number(total2) === 0)

  console.log(failures === 0 ? '\nSmoke test passed.' : `\n${failures} CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
