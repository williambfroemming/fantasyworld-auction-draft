/**
 * Manager colours for the League board.
 *
 * Constraints this palette has to satisfy simultaneously:
 *   1. Ten of them, all telling apart at a glance across a wide grid.
 *   2. Readable as *text* on a near-black background (so: light, ~65% lightness).
 *   3. Readable as a *background* behind dark text (the column headers).
 *   4. Not reliant on colour alone — every column is also labelled, because a
 *      couple of people in any ten will have some colour vision deficiency.
 *
 * Ten hues cannot all be far apart, so the pairs that sit closest (green/teal,
 * sky/indigo) are deliberately never assigned to neighbouring seats — see
 * SEAT_ORDER below.
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

/** Colour for a given seat index (0-based), wrapping if there are ever >10. */
export function colorForSeat(seat: number): string {
  return PALETTE[SEAT_ORDER[seat % SEAT_ORDER.length]].hex
}

export function colorNameForSeat(seat: number): string {
  return PALETTE[SEAT_ORDER[seat % SEAT_ORDER.length]].name
}

/**
 * Text colour to place ON a manager's colour.
 *
 * The palette is deliberately light, so near-black text is correct for all of
 * it — but this computes relative luminance rather than assuming, so a
 * hand-edited colour can't silently produce unreadable headers.
 */
export function textOn(hex: string): string {
  const m = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return luminance > 0.45 ? '#0f172a' : '#ffffff'
}
