import Link from 'next/link'

/**
 * The app's two sections, and where you are in one of them.
 *
 * ## Why two sections rather than a flat set of pages
 *
 * These are two products sharing a database. The draft pages are a live tool:
 * ten people, one room, three hours a year, polling every 400ms with money on
 * the line. The history pages are a reference read at leisure, rendered
 * statically once an hour. They have different cadences, different audiences and
 * different failure modes, and a flat nav that mixes them invites somebody to
 * treat one like the other.
 *
 * It also fixes a smaller thing: `/history` first shipped with a "← Board"
 * button, which quietly claimed history was a sub-page of the draft.
 *
 * ## No trust lives here
 *
 * `isCommish` only decides whether a link is *drawn*. Every commissioner action
 * re-reads `is_commish` from the database against the session id, so hiding the
 * link is presentation and nothing more.
 *
 * Presentational and hook-free, so it renders inside the client draft pages and
 * the server-rendered history pages alike.
 */

export type Section = 'draft' | 'history'

interface NavItem {
  href: string
  label: string
  /** Drawn only for the commissioner. Never a security boundary. */
  commishOnly?: boolean
}

const SECTIONS: Record<Section, { label: string; home: string; items: NavItem[] }> = {
  draft: {
    label: 'Draft',
    home: '/draft',
    items: [
      { href: '/draft', label: 'Draft' },
      { href: '/board', label: 'Board' },
      { href: '/stats', label: 'Stats' },
      { href: '/trades', label: 'Trades' },
      { href: '/setup', label: 'Setup', commishOnly: true },
    ],
  },
  history: {
    label: 'History',
    home: '/history',
    // Listed as they are built. A nav that points at a 404 is worse than a
    // short nav — it makes the section look broken rather than unfinished.
    items: [{ href: '/history', label: 'Summary' }],
  },
}

export function SiteNav({
  section,
  current,
  isCommish = false,
}: {
  section: Section
  /** The active pathname, so the current page is marked rather than guessed. */
  current: string
  isCommish?: boolean
}) {
  const items = SECTIONS[section].items.filter((i) => !i.commishOnly || isCommish)

  return (
    <nav className="flex flex-wrap items-center gap-x-3 gap-y-1.5" aria-label="Site sections">
      {/*
        The wordmark. The league is FantasyWorld; the auction draft is one thing
        it does and the history is another, so the name belongs above both rather
        than being one of them.
      */}
      <Link
        href="/"
        className="font-display text-sm font-bold uppercase tracking-[0.12em] text-slate-100 hover:text-amber-300"
      >
        FantasyWorld
      </Link>

      <span aria-hidden className="h-4 w-px bg-rule" />

      {/* The two sections. Whichever you are not in is a plain link home. */}
      <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-1">
        {(Object.keys(SECTIONS) as Section[]).map((key) => (
          <Link
            key={key}
            href={SECTIONS[key].home}
            aria-current={key === section ? 'page' : undefined}
            className={`rounded-md px-2.5 py-1 font-display text-xs font-semibold uppercase tracking-[0.06em] ${
              key === section
                ? 'bg-slate-700 text-slate-50'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            {SECTIONS[key].label}
          </Link>
        ))}
      </div>

      <span aria-hidden className="h-4 w-px bg-rule" />

      <ul className="flex flex-wrap items-center gap-1">
        {items.map((item) => {
          const active = current === item.href
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-md px-2 py-1 text-xs font-semibold ${
                  active
                    ? 'bg-slate-800 text-slate-100'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                }`}
              >
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
