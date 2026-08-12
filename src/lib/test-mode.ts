/**
 * Multi-seat test console gate.
 *
 * The console at /test can act as ANY manager without their PIN, which is
 * exactly what you want for verification and exactly what must never exist in
 * production. It is off unless ENABLE_TEST_SEATS=1 is set explicitly, and the
 * flag is deliberately not set in any Vercel environment.
 *
 * Both the page and the API route check this independently — a single guard in
 * one place is one refactor away from being bypassed.
 */
export const TEST_SEATS_ENABLED = process.env.ENABLE_TEST_SEATS === '1'
