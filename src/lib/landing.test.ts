import { describe, expect, it } from 'vitest'
import { landingDestination } from './landing'

/**
 * All four cases, because the two obvious ones are not the dangerous ones.
 *
 * The case worth the file is **live draft + signed out**. It only occurs on
 * draft night, to someone who has not taken a seat yet, which is exactly when
 * nobody has the patience to work out why the app is showing them a league
 * history page — and it is the case a landing page silently introduces, since
 * before this route existed a signed-out visitor always got the seat picker.
 */
describe('landingDestination', () => {
  it('sends a signed-in manager into a live draft', () => {
    expect(landingDestination({ complete: false, signedIn: true })).toBe('/draft')
  })

  it('sends a signed-out visitor to the seat picker while the draft is live', () => {
    expect(landingDestination({ complete: false, signedIn: false })).toBe('/join')
  })

  it('renders the front page once every roster is full, signed in', () => {
    expect(landingDestination({ complete: true, signedIn: true })).toBeNull()
  })

  it('renders the front page once every roster is full, signed out', () => {
    expect(landingDestination({ complete: true, signedIn: false })).toBeNull()
  })

  /**
   * The ordering guarantee, stated as a test so it cannot be refactored away: no
   * session state may route a live draft anywhere but into the draft. If someone
   * later reverses the branches so that `signedIn` is checked first, this still
   * passes — but the two live cases above stop agreeing with it, which is the
   * point of keeping all three.
   */
  it('never renders the front page while anybody is unfilled', () => {
    for (const signedIn of [true, false]) {
      expect(landingDestination({ complete: false, signedIn })).not.toBeNull()
    }
  })
})
