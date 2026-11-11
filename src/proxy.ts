import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { SESSION_COOKIE, sessionSecret, verifySession } from '@/lib/auth'
import { isPublicPath } from '@/lib/gate'

/**
 * The front gate: nobody sees any page or any API without a valid PIN session.
 *
 * Light authentication on purpose (see src/lib/auth.ts for the threat model). This only
 * checks that the cookie is a genuine, unforged session — HMAC, no database — so it adds
 * nothing to the cost of a request, including the 400ms polling of /api/state.
 *
 *  - A signed-out page request goes to /join, remembering where it was headed.
 *  - A signed-out API request gets a 401 JSON body, never a redirect to HTML.
 *
 * Who the visitor IS (and whether they are the commissioner) is still decided by each
 * route from the session; this file only decides whether there is one at all.
 */
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  if (isPublicPath(pathname)) return NextResponse.next()

  const signedIn =
    verifySession(req.cookies.get(SESSION_COOKIE)?.value, sessionSecret()) !== null
  if (signedIn) return NextResponse.next()

  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { ok: false, reason: 'Not signed in' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const to = new URL('/join', req.url)
  if (pathname !== '/') to.searchParams.set('next', pathname + search)
  return NextResponse.redirect(to)
}

export const config = {
  // Everything except Next's own static assets and the site icons.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)'],
}
