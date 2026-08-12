/**
 * Refuse to run destructive tests against anything but the test database.
 *
 * This replaces `check-idle.ts` as the primary safety mechanism. That script
 * detected a *likely* problem (someone connected); this one makes the dangerous
 * case impossible: if TEST_DATABASE_URL is missing, or is the same database as
 * DATABASE_URL, nothing runs.
 */
const test = process.env.TEST_DATABASE_URL
const prod = process.env.DATABASE_URL

function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`)
  process.exit(1)
}

if (!test) die('TEST_DATABASE_URL is not set. Run `npm run db:test-setup` first.')
if (test === prod) die('TEST_DATABASE_URL is the same as DATABASE_URL. Refusing to wipe the live draft.')

const name = (u: string) => {
  try { return new URL(u).pathname.slice(1) } catch { return '?' }
}
if (prod && name(test) === name(prod)) {
  die(`Both URLs point at database "${name(test)}". Refusing.`)
}

console.log(`✓ destructive tests will run against "${name(test)}" (live draft is "${name(prod ?? '')}")`)
