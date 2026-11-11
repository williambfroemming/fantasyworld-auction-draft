import { NextResponse } from 'next/server'
import { z } from 'zod'
import { DAILY_LIMIT, askOracle, logQuestion, questionsToday } from '@/server/oracle-service'
import { currentManagerId } from '@/server/session'

/**
 * POST /api/ask { question } — "Ask the Oracle" (docs/ANALYTICS_ROADMAP.md §A, step 42).
 *
 * ## Rules this route exists to keep
 *
 * 1. **The manager id comes from the signed session cookie, never the body.** There is
 *    no id field to send; the cap and the log are keyed on the caller.
 * 2. **Signed-in members only, with a daily cap.** Every question spends money.
 * 3. **Off every polling path.** Nothing here touches /api/state or src/lib/version.ts,
 *    and nothing polls this route. That is the only reason it is allowed to make an
 *    outbound call and to run for tens of seconds. The Gazette never reads it either.
 *
 * `no-store, private`: an answer is one member's, never cacheable by anything shared.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store, private' }

const Body = z.object({ question: z.string().trim().min(3).max(500) })

export async function POST(req: Request) {
  const managerId = await currentManagerId()
  if (managerId === null) {
    return NextResponse.json(
      { ok: false, reason: 'Sign in to ask the Oracle' },
      { status: 401, headers: NO_STORE },
    )
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, reason: 'Ask a question of between 3 and 500 characters.' },
      { status: 400, headers: NO_STORE },
    )
  }
  const { question } = parsed.data

  const used = await questionsToday(managerId)
  if (used.count >= DAILY_LIMIT) {
    const when = used.freesAt
      ? ` Your next question frees up around ${used.freesAt.toUTCString()}.`
      : ''
    return NextResponse.json(
      {
        ok: false,
        reason: `You have used all ${DAILY_LIMIT} of your questions for the last 24 hours.${when}`,
      },
      { status: 429, headers: NO_STORE },
    )
  }

  const started = Date.now()
  const result = await askOracle(question)
  // Logged whether or not it worked: a failure is what we most want to read afterwards.
  await logQuestion(managerId, question, result, Date.now() - started).catch((err) => {
    console.error('oracle_log insert failed', err)
  })

  return NextResponse.json(
    {
      ok: result.ok,
      answer: result.answer,
      steps: result.steps,
      error: result.error,
      remaining: Math.max(0, DAILY_LIMIT - used.count - 1),
    },
    { headers: NO_STORE },
  )
}
