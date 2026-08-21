import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Where an issue's generated art lives, if it has any.
 *
 * ## Why a file on disk and not a column
 *
 * The art is made **once**, when the issue is written, and committed under
 * `public/gazette/`. Nothing here calls an image provider — the same rule that
 * keeps Sleeper off `/api/state` and that got the live news feed removed
 * (`docs/BACKLOG.md` §1): a third party on a request path is a class of failure
 * this app does not have, and generating on demand would also pay for the same
 * picture on every visit.
 *
 * The path is a **convention, not a stored value**, deliberately. A column would
 * mean a migration on `week_issues`, and that table is the Gazette's. Naming the
 * file after the issue means the two cannot disagree: if the file is there the
 * page shows it, if it is not the page says so, and nothing has to be kept in
 * sync. Regenerating art is then just overwriting a file.
 *
 * ⚠️ **Null is the normal case, not an error.** Every issue written before the
 * art step existed has none, and a provider outage at generation time leaves the
 * prose perfectly publishable. Callers render the headline without a picture —
 * they never treat this as a failure.
 */

/** Extensions we will serve, best first. */
const EXTENSIONS = ['webp', 'jpg', 'png'] as const

/** The public URL of an issue's art, or null if it has not been generated. */
export function issueArt(season: number, week: number): string | null {
  for (const ext of EXTENSIONS) {
    const rel = `gazette/${season}-${week}.${ext}`
    // `existsSync` rather than a read: this is one stat call on a page that is
    // visited occasionally, and the alternative — an <img> that 404s — would
    // draw a broken frame before anything could react to it.
    if (existsSync(join(process.cwd(), 'public', rel))) return `/${rel}`
  }
  return null
}
