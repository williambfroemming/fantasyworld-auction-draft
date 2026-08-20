/**
 * Manager colours for the League board.
 *
 * Constraints this palette has to satisfy simultaneously:
 *   1. Ten of them, all telling apart at a glance across a wide grid.
 *   2. Readable as *text* on the page ground.
 *   3. Readable as a *background* behind its own ink (the column headers).
 *   4. Not reliant on colour alone — every column is also labelled, because a
 *      couple of people in any ten will have some colour vision deficiency.
 *
 * Ten hues cannot all be far apart, so the pairs that sit closest (green/teal,
 * sky/indigo) are deliberately never assigned to neighbouring seats — see
 * SEAT_ORDER below.
 *
 * ── Two grounds, one stored value ──
 *
 * The app ships a light theme (newsprint) and a dark one (Late Edition). These
 * ten hues are tuned for the dark ground and wash out on paper, so there is a
 * second set, re-cut as print inks. Both live in `src/app/globals.css` as
 * `--mgr-*` variables that swap on `prefers-color-scheme`.
 *
 * `managers.color` in the database stores the **canonical dark hex below** —
 * that is the manager's identity and it never changes. `managerColor()` maps it
 * to the CSS variable so the right value is picked at paint time.
 */
export const PALETTE = [
  { name: 'red', hex: '#f87171' },
  { name: 'orange', hex: '#fb923c' },
  { name: 'amber', hex: '#fbbf24' },
  { name: 'lime', hex: '#a3e635' },
  { name: 'green', hex: '#4ade80' },
  { name: 'teal', hex: '#2dd4bf' },
  { name: 'sky', hex: '#38bdf8' },
  { name: 'indigo', hex: '#818cf8' },
  { name: 'purple', hex: '#c084fc' },
  { name: 'pink', hex: '#f472b6' },
] as const

/**
 * The order colours are handed out by seat, alternating warm and cool so that
 * adjacent columns on the board are always strongly different. Walking the
 * palette in its natural rainbow order would put teal next to green and sky
 * next to indigo, which is exactly the complaint this palette is fixing.
 */
const SEAT_ORDER = [0, 6, 2, 8, 4, 9, 7, 1, 5, 3] as const

/**
 * Colour for a given seat index (0-based), wrapping if there are ever >10.
 *
 * Returns the raw canonical hex on purpose: this is what gets **written to
 * `managers.color`** at setup. Do not make it return a CSS variable — the
 * stored value has to survive being read outside a browser (exports, scripts,
 * `db:verify`), and it is the key `managerColor()` looks up.
 */
export function colorForSeat(seat: number): string {
  return PALETTE[SEAT_ORDER[seat % SEAT_ORDER.length]].hex
}

export function colorNameForSeat(seat: number): string {
  return PALETTE[SEAT_ORDER[seat % SEAT_ORDER.length]].name
}

const VAR_BY_HEX = new Map<string, string>(
  PALETTE.map((p) => [p.hex.toLowerCase(), `--mgr-${p.name}`]),
)

/**
 * Map a stored `managers.color` hex to the theme-aware CSS variable.
 *
 * Applied once where managers are serialised (`draft-service`, `archive-service`)
 * so every component that does `style={{ color: m.color }}` is theme-correct
 * without knowing this exists.
 *
 * An unrecognised hex passes through untouched — a hand-edited colour still
 * renders, it just won't follow the theme.
 */
export function managerColor(stored: string): string {
  const v = VAR_BY_HEX.get(stored.trim().toLowerCase())
  return v ? `var(${v})` : stored
}

/**
 * A translucent wash of a manager's colour — for the tinted cells on the board
 * and the "this is you" chips.
 *
 * Exists because the old `` `${m.color}33` `` trick appends hex alpha, which
 * silently produces garbage the moment the colour is a `var()` reference.
 */
export function managerTint(color: string, percent: number): string {
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`
}

/**
 * Text colour to place ON a manager's colour.
 *
 * For a mapped colour this returns the matching `--mgr-*-ink` variable, which
 * globals.css computed from the fill's own luminance — so it is correct on
 * either ground without this function knowing which theme is showing.
 *
 * The fallback path handles a raw hex. Note the 0.25 threshold: the old 0.45
 * put white text on `#f87171`, which is 2.8:1 and fails AA. These hues are
 * mid-light, and near-black is the right ink for all of them.
 */
export function textOn(color: string): string {
  const asVar = /^var\((--mgr-[a-z]+)\)$/.exec(color.trim())
  if (asVar) return `var(${asVar[1]}-ink)`

  const m = color.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return luminance > 0.25 ? '#17150f' : '#f7f2e6'
}

/**
 * The positional spend palette, used by every stacked spend bar.
 *
 * ⚠️ Not in `SPEND_COLUMNS` order, deliberately. Rose (QB) against emerald (RB)
 * is ΔE 4.6 under deuteranopia — indistinguishable for the ~1 in 12 men with
 * it, and a bar has no room for the labels that make `PositionBadge` safe.
 * Interleaving them costs nothing and lifts the worst adjacent pair to 10.6.
 * Same trick, same reason as `SEAT_ORDER` above.
 *
 * Lives here rather than beside the first bar that needed it because there are
 * now two of them — the draft-night Budgets panel and Draft DNA on a member
 * page — and a second copy of a palette is how two views of the same split end
 * up disagreeing about which colour a receiver is.
 */
export const SPEND_SEGMENTS: Array<{ key: string; label: string; hex: string }> = [
  { key: 'WR', label: 'WR', hex: '#38bdf8' },
  { key: 'QB', label: 'QB', hex: '#fb7185' },
  { key: 'TE', label: 'TE', hex: '#fbbf24' },
  { key: 'RB', label: 'RB', hex: '#34d399' },
  // Grey on purpose: K and DEF are the residue, and a residual bucket reading as
  // "not a real category" is the correct signal, not a palette failure.
  { key: 'OTHER', label: 'K/DEF', hex: '#64748b' },
]
