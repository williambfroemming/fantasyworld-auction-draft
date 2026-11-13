import { NextResponse } from 'next/server'
import { z } from 'zod'
import { MAX_DISPLAY_NAME, startChallenge, submitJoinRequest } from '@/server/onboarding-service'

/**
 * Sign-up for someone new to the league. PUBLIC — see src/lib/gate.ts.
 *
 *   POST { action: 'challenge', provider: 'sleeper', username }
 *        → { ok, data: { token, code, username, instructions, expiresAt } }
 *   POST { action: 'request', token, displayName, pin }
 *        → { ok, data: { displayName } }    a pending request for the commissioner
 *
 * Public because the person asking has no PIN yet. What keeps that safe:
 *
 * - It says nothing about any seat. The worst it reveals is "that Sleeper account is in
 *   this league" — which Sleeper's own public API already says to anyone.
 * - It creates nothing a stranger can use. A request only exists after the code was
 *   found in that account's team name, and it is only a seat once the commissioner
 *   approves it.
 *
 * ⚠️ The one public route that calls a third party. Nothing polls it, and it must stay
 * off `/api/state` and the draft path (sleeper.test.ts asserts draft-service never
 * fetches).
 */
export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store, private' }

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('challenge'), provider: z.literal('sleeper'), username: z.string().min(1).max(60) }),
  z.object({
    action: z.literal('request'),
    token: z.string().min(1).max(2000),
    displayName: z.string().max(MAX_DISPLAY_NAME * 2),
    pin: z.string().max(10),
  }),
])

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: 'Bad request' }, { status: 400, headers: NO_STORE })
  }
  const b = parsed.data
  const result =
    b.action === 'challenge'
      ? await startChallenge(b.provider, b.username)
      : await submitJoinRequest({ token: b.token, displayName: b.displayName, pin: b.pin })
  return NextResponse.json(result, { headers: NO_STORE })
}
