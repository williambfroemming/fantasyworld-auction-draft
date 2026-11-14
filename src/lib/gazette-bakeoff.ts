/**
 * The Gazette bake-off page (docs/GAZETTE_ROADMAP.md step 84): the pure half.
 *
 * The editorial room replaces the weekly column only if the league prefers it,
 * read blind. So for a few consecutive weeks both arms write an edition from the
 * same pack, and this renders them side by side as "Edition X" and "Edition Y",
 * with the arm behind each letter shuffled per week. The page goes to the league;
 * the answer key stays with the commissioner.
 *
 * Three rules this file exists to keep:
 *
 * - **Nothing on the page names an arm.** No "pipeline", no "single-pass", no
 *   prompt version, no lens (the two arms choose a lens differently, which is a
 *   tell), no notebook. Only what a reader of the real paper would see.
 * - **The labels are random, not seeded.** Every other shuffle in the room is
 *   seeded so a run can be reproduced; this one must not be predictable from the
 *   season and week, or anyone who read the code could decode the page. The key
 *   is the only record of which was which.
 * - **Self-contained.** One HTML file with its styles inline, no script, no
 *   request to anywhere, so it can be emailed, dropped in a group chat or opened
 *   offline. It is written under `backups/` (git-ignored), never `public/`.
 */

export type Arm = 'single-pass' | 'pipeline'

/** What a reader sees of one edition. */
export interface BakeoffEdition {
  issueTitle: string
  headline: string
  deck: string
  column: string
  gameNotes: string[]
}

export interface BakeoffWeek {
  season: number
  week: number
  weekLabel: string
  editions: Record<Arm, BakeoffEdition>
}

export interface BakeoffKeyEntry {
  season: number
  week: number
  X: Arm
  Y: Arm
}

/** Which arm is Edition X for each week. `rand` is injectable for tests only. */
export function assignLabels(weeks: Array<Pick<BakeoffWeek, 'season' | 'week'>>, rand: () => number = Math.random): BakeoffKeyEntry[] {
  return weeks.map(({ season, week }) => {
    const pipelineIsX = rand() < 0.5
    return {
      season,
      week,
      X: pipelineIsX ? 'pipeline' : 'single-pass',
      Y: pipelineIsX ? 'single-pass' : 'pipeline',
    }
  })
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** A column is plain text with blank lines between paragraphs. */
function paragraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n')
}

function edition(letter: 'X' | 'Y', e: BakeoffEdition): string {
  const notes = e.gameNotes.length
    ? `<h4>The games</h4>\n<ul>${e.gameNotes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>`
    : ''
  return `<article>
<div class="label">Edition ${letter}</div>
<div class="title">${escapeHtml(e.issueTitle)}</div>
<h3>${escapeHtml(e.headline)}</h3>
<p class="deck">${escapeHtml(e.deck)}</p>
${paragraphs(e.column)}
${notes}
</article>`
}

const STYLE = `
:root { color-scheme: light dark; --bg: #f7f3ea; --fg: #1d1b18; --muted: #6b645a; --rule: #d8cfbf; --card: #fffdf8; }
@media (prefers-color-scheme: dark) { :root { --bg: #151412; --fg: #ece6da; --muted: #a39b8d; --rule: #3a362f; --card: #1d1b18; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.6 Georgia, 'Times New Roman', serif; }
main { max-width: 1200px; margin: 0 auto; padding: 24px 16px 64px; }
header h1 { font-size: 30px; margin: 0 0 6px; letter-spacing: .01em; }
header p { color: var(--muted); margin: 0 0 8px; max-width: 70ch; }
section { border-top: 2px solid var(--fg); margin-top: 40px; padding-top: 12px; }
section > h2 { font: 600 13px/1.4 system-ui, sans-serif; letter-spacing: .12em; text-transform: uppercase; margin: 0 0 16px; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
@media (max-width: 820px) { .pair { grid-template-columns: 1fr; } }
article { background: var(--card); border: 1px solid var(--rule); padding: 20px; min-width: 0; }
.label { font: 700 12px/1 system-ui, sans-serif; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); margin-bottom: 10px; }
.title { font-style: italic; color: var(--muted); }
article h3 { font-size: 24px; line-height: 1.25; margin: 4px 0 8px; }
.deck { font-style: italic; font-size: 18px; border-bottom: 1px solid var(--rule); padding-bottom: 12px; }
h4 { font: 600 12px/1.4 system-ui, sans-serif; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); margin: 20px 0 6px; }
ul { padding-left: 18px; margin: 0; } li { margin: 4px 0; font-size: 15px; }
.vote { margin-top: 16px; font: 15px/1.5 system-ui, sans-serif; color: var(--muted); }
`

/**
 * The page. `key` decides which edition sits under which letter each week; the
 * page itself never says.
 */
export function renderBakeoffPage(weeks: BakeoffWeek[], key: BakeoffKeyEntry[], title = 'The Gazette: a blind taste test'): string {
  const byWeek = new Map(key.map((k) => [`${k.season}:${k.week}`, k]))
  const sections = weeks.map((w) => {
    const k = byWeek.get(`${w.season}:${w.week}`)
    if (!k) throw new Error(`no label for ${w.season} week ${w.week}`)
    return `<section>
<h2>${escapeHtml(w.weekLabel)} · ${w.season}</h2>
<div class="pair">
${edition('X', w.editions[k.X])}
${edition('Y', w.editions[k.Y])}
</div>
<p class="vote">${escapeHtml(w.weekLabel)}: which would you rather read, X or Y?</p>
</section>`
  })
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header>
<h1>${escapeHtml(title)}</h1>
<p>Two versions of the Gazette, written from exactly the same week. Read both, then pick the one you would rather read. Which is which changes from week to week, so take each week on its own.</p>
<p>Reply with a letter per week, e.g. "${weeks.map((w) => `${w.weekLabel.replace(/^Week\s*/i, 'wk ')}: X`).join(', ')}".</p>
</header>
${sections.join('\n')}
</main>
</body>
</html>
`
}
