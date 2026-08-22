/**
 * Where a visitor to `/` actually ends up.
 *
 * ## Why this is a pure function and not three lines in the page
 *
 * The rule has **four** cases, not two, and the two easy ones are the ones
 * everybody writes first. "Signed in and the draft is over → show the front
 * page" is the feature; "signed out and the draft is live → the seat picker" is
 * the case that decides whether draft night works. Getting that one wrong strands
 * a manager on a league-history page with no way to sign in, at the exact moment
 * ten people are waiting on them — and it fails in the state that is hardest to
 * reproduce out of season, because it needs a live draft AND no cookie.
 *
 * So the rule lives here, where `landing.test.ts` can walk all four cases without
 * a database, a cookie or a browser.
 *
 * ## The rule
 *
 * ```
 *                    │ signed in   │ signed out
 *   ─────────────────┼─────────────┼────────────
 *   draft live       │ /draft      │ /join
 *   draft complete   │ (front page)│ (front page)
 * ```
 *
 * While a draft is live, `/` behaves exactly as it did before the front page
 * existed. That is the point: `docs/BACKLOG.md` §11 forbids putting a landing
 * page in front of draft night, because the gap between signing in and being
 * able to nominate is the one place in this app where an extra click has a real
 * cost — a room of ten people, already bidding.
 */

export interface LandingContext {
  /**
   * Every roster full. Comes from `getLiveSeason().unfilled === 0`, never from
   * `draft.status === 'done'` — the flag is set by hand and lags. See
   * `docs/BACKLOG.md` §9 P1.
   */
  complete: boolean
  signedIn: boolean
}

/** The path to redirect to, or null to render the front page. */
export type LandingDestination = '/draft' | '/join' | null

export function landingDestination({ complete, signedIn }: LandingContext): LandingDestination {
  // A finished draft is the only state that earns a front page. Note the order:
  // completeness is checked first precisely so that no session state can route a
  // live draft anywhere except into the draft.
  if (complete) return null
  return signedIn ? '/draft' : '/join'
}
