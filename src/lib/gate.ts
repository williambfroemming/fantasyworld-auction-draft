/**
 * Who may see what without signing in.
 *
 * The whole site sits behind the PIN session. This is the entire allow-list: the
 * sign-in page, the two endpoints it needs, and nothing else. It is a pure module so
 * the rule can be tested without a server — and because "which paths are public" is
 * exactly the kind of list that grows by accident, it is kept short and kept here.
 *
 * ⚠️ Add to it deliberately. A path listed here is readable by anyone on the internet.
 */

/** Exact paths anyone may request. */
const PUBLIC_PATHS = new Set([
  '/join', // the sign-in page, which is what a signed-out visitor is sent to
  '/api/session', // sign in (POST) and "who am I" (GET)
  '/api/seats', // the names on the sign-in screen: id, name, colour, whether a PIN is set
])

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname)
}

/**
 * Where to send someone after they sign in, taken from `?next=`.
 *
 * Only a same-site path is honoured. Anything that could leave the site —
 * `//evil.example`, `/\evil.example`, `https://…`, `javascript:` — falls back to the
 * front page, because a sign-in screen that redirects to an arbitrary URL is a phishing
 * helper. The sign-in page itself is also refused, which would loop.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || next.length > 500) return '/'
  if (!next.startsWith('/')) return '/'
  if (next.startsWith('//') || next.startsWith('/\\')) return '/'
  if (/[\u0000-\u001f]/.test(next)) return '/'
  if (next === '/join' || next.startsWith('/join?') || next.startsWith('/join/')) return '/'
  return next
}
