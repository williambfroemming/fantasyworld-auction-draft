import Link from 'next/link'

/**
 * A `?` beside a panel heading, linking to that metric's row in the glossary.
 *
 * Deliberately one per panel rather than one per column. The version of this
 * with a marker on every metric turned each table header into a rash of
 * punctuation and made the headings harder to read than the paragraph of
 * methodology it replaced — which was the thing being fixed.
 *
 * No `'use client'`: it is a `Link` and nothing else, so it renders inside the
 * server-rendered history pages and the client-rendered stats panels alike.
 */
export function GlossaryLink({ anchor, label }: { anchor: string; label?: string }) {
  return (
    <Link
      href={`/glossary#${anchor}`}
      title="How this is worked out"
      aria-label={label ? `How ${label} is worked out` : 'How this is worked out'}
      className="shrink-0 text-[11px] leading-none text-slate-600 transition-colors hover:text-amber-300"
    >
      ?
    </Link>
  )
}
