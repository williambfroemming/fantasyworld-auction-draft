/**
 * Compose the "new issue is out" email for one Gazette edition.
 *
 *   npm run gazette:notify -- 2026 1 --out mail.txt   # write an RFC822 message
 *   npm run gazette:notify -- 2026 1 --print          # to stdout, send nothing
 *   npm run gazette:notify -- --latest --print        # whatever the newest issue is
 *
 * ## This composes; it does not send
 *
 * The workflow pipes the file it writes into `curl`, which speaks SMTP. That
 * split is deliberate and worth keeping: composing needs the database and no
 * credentials, sending needs credentials and no database, and a script that
 * holds both is a script nobody can run locally to check their own wording.
 * `--print` is the whole message, safely, with no key anywhere near it.
 *
 * ## Why an email at all
 *
 * The paper publishes at noon on a Tuesday into a repository. Ten people then
 * have to independently remember to go and look at a website, which is the
 * failure mode every internal newsletter dies of. This is a nudge with a link,
 * deliberately short: the subject is the headline, the body is the standfirst
 * and a URL. Reproducing the issue in the mail would give people a reason not
 * to open the thing the whole pipeline exists to produce.
 *
 * ⚠️ **It never reproduces figures from the issue.** Everything the Gazette
 * prints has been through `ungroundedNumbers()` against the pack it was written
 * from; a number retyped here would be outside that gate, and the one place a
 * hallucinated score could reach a reader is the one place nothing checks it.
 * Headline and deck are copied verbatim, as strings, and nothing is computed.
 */
import 'dotenv/config'
import { writeFileSync } from 'node:fs'
import { getSql } from '../../src/server/sql'

const SITE = process.env.GAZETTE_SITE_URL ?? 'https://fantasyworld-auction-draft.vercel.app'

const args = process.argv.slice(2).filter((a) => a !== '--')
const nums = args.filter((a) => /^\d+$/.test(a)).map(Number)
const season = nums.find((n) => n >= 2000)
const week = nums.find((n) => n < 2000)
/**
 * The newest issue on record, whichever it is.
 *
 * Exists so the mail path can be tested without waiting for a Tuesday that owes
 * an edition. The weekly job never uses it — it names the week it just wrote, so
 * a race with a concurrent run cannot make it announce the wrong issue.
 */
const latest = args.includes('--latest')
const outIdx = args.indexOf('--out')
const out = outIdx >= 0 ? args[outIdx + 1] : null
const print = args.includes('--print')

/**
 * Fold a header value that may contain non-ASCII into RFC 2047.
 *
 * ⚠️ Gordon writes em dashes and curly quotes, and a raw one in a Subject line
 * arrives as mojibake in most clients. The body declares UTF-8 in its own
 * header; headers have to encode it themselves.
 */
function encodeHeader(value: string): string {
  if (/^[\x20-\x7E]*$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

/** Strip anything that could inject a second header. */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

async function main() {
  if (!season && !latest) {
    console.error(
      'Usage: npm run gazette:notify -- <season> <week> [--out FILE | --print]\n' +
        '       npm run gazette:notify -- --latest [--out FILE | --print]',
    )
    process.exit(1)
  }

  const sql = getSql()
  const rows = latest
    ? await sql`
        SELECT season, week, headline, deck, issue_title
          FROM week_issues
         ORDER BY season DESC, week DESC
         LIMIT 1`
    : await sql`
        SELECT season, week, headline, deck, issue_title
          FROM week_issues
         WHERE season = ${season} AND week = ${week ?? 0}`

  if (rows.length === 0) {
    // Not an error. The workflow calls this after a run that may legitimately
    // have written nothing, and a missing issue means there is no news to send.
    console.error(
      latest
        ? '· no issues stored at all — nothing to send'
        : `· no issue stored for ${season} week ${week} — nothing to send`,
    )
    process.exit(0)
  }

  const issue = rows[0]
  const from = process.env.GAZETTE_MAIL_FROM ?? ''
  const to = process.env.GAZETTE_MAIL_TO ?? ''
  if (!from || !to) {
    console.error('✗ GAZETTE_MAIL_FROM and GAZETTE_MAIL_TO must be set')
    process.exit(1)
  }

  const url = `${SITE}/history/gazette/${issue.season}/${issue.week}`
  const label = Number(issue.week) === 0 ? 'Season preview' : `Week ${issue.week}`
  /**
   * Set to `[TEST] ` by the test workflow, empty everywhere else.
   *
   * ⚠️ A test send is a real email about a real issue — out of season, the
   * newest issue is the season preview, which is months old. Without a marker
   * in the subject the league would get what reads as a fresh edition on a
   * Thursday in September, which is precisely the confusion the weekly job's
   * owed-week guard exists to prevent. The body says it too, because subjects
   * get truncated on a phone.
   */
  const prefix = process.env.GAZETTE_SUBJECT_PREFIX ?? ''
  const isTest = prefix.trim().length > 0
  const subject = oneLine(`${prefix}The FantasyWorld Gazette — ${label}: ${issue.headline}`)

  // Recipients go in Bcc with an undisclosed To, so ten people's addresses are
  // not published to each other on every send.
  const message = [
    `From: The FantasyWorld Gazette <${oneLine(from)}>`,
    `To: undisclosed-recipients:;`,
    `Bcc: ${oneLine(to)}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    ...(isTest
      ? [
          'This is a TEST of the Gazette notification, sent by hand.',
          `It points at the newest issue on record (${issue.season} ${label.toLowerCase()}),`,
          'which is not necessarily a new one. Nothing has been published today.',
          '',
          '---',
          '',
        ]
      : []),
    String(issue.issue_title ?? '').trim(),
    '',
    String(issue.headline).trim(),
    '',
    String(issue.deck ?? '').trim(),
    '',
    `Read it: ${url}`,
    '',
    `The season so far: ${SITE}/`,
    '',
    '— filed by Gordon Applewhite',
  ].join('\r\n')

  if (print) console.log(message)
  if (out) {
    writeFileSync(out, message, 'utf8')
    console.error(`✓ wrote ${out} — ${subject}`)
  }
  if (!print && !out) console.log(message)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
