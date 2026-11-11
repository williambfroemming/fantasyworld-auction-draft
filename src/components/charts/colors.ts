/**
 * Colours for series that are not managers. They are the same theme-aware inks the
 * manager palette uses (`--mgr-*` in globals.css), so they swap with Paper and Night.
 * Managers keep their own colour: pass `managerColor(m.color)` from src/lib/colors.ts.
 */
export const CHART_INKS = [
  'var(--mgr-sky)',
  'var(--mgr-orange)',
  'var(--mgr-green)',
  'var(--mgr-purple)',
  'var(--mgr-amber)',
  'var(--mgr-pink)',
  'var(--mgr-teal)',
  'var(--mgr-red)',
] as const

export const INK = 'var(--s-200)'
export const INK_SOFT = 'var(--s-300)'
export const INK_FAINT = 'var(--s-400)'
export const GRID = 'var(--rule)'
