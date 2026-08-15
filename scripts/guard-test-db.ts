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

// Not `name`: that collides with the DOM's global `name` under our tsconfig lib
// and turns this file into a wall of confusing type errors.
const dbName = (u: string) => {
  try { return new URL(u).pathname.slice(1) } catch { return '?' }
}
if (prod && dbName(test) === dbName(prod)) {
  die(`Both URLs point at database "${dbName(test)}". Refusing.`)
}

console.log(`✓ destructive tests will run against "${dbName(test)}" (live draft is "${dbName(prod ?? '')}")`)
