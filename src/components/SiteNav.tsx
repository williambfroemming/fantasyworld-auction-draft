import Link from 'next/link'

/**
 * Three sections, each a hover menu.
 *
 * ## Why three, and why these three
 *
 * The first cut had two — Draft and History — and everything draft-shaped piled
 * into one flat row. That conflated two genuinely different questions: *what is
 * happening in this auction* and *what happened in past auctions*. They share
 * pages but not intent, and a row of eight equal-weight links made the reader do
 * that sorting themselves.
 *
 *   Draft          — the live tool. Ten people, one room, three hours a year.
 *   Draft History  — past auctions: who paid what, and whether it was worth it.
 *   League History — the seasons themselves: records, championships, standings.
 *
 * ## Why hover menus rather than a flat row
 *
 * A flat row grows one item per feature and never shrinks. Nesting keeps the top
 * level at three stable words, so the shape of the app is legible before you read
 * any of it.
 *
 * The menus are **CSS-only** — `group-hover` plus `group-focus-within` — which
 * keeps this component hook-free, so it renders unchanged inside the client draft
 * pages and the server-rendered history pages. It also means the menus work with
 * JavaScript still loading, which on draft night is worth having.
 *
 * Keyboard users reach every item by tabbing: the trigger is a real link and
 * `focus-within` holds the menu open while anything inside it has focus.
 *
 * ## No trust lives here
 *
 * `isCommish` only decides whether a link is *drawn*. Every commissioner action
 * re-reads `is_commish` from the database against the session id.
 */

export type Section = 'draft' | 'draft-history' | 'league-history'

interface NavItem {
  href: string
  label: string
  hint?: string
  /** Drawn only for the commissioner. Never a security boundary. */
  commishOnly?: boolean
}

interface SectionDef {
  key: Section
  label: string
  home: string
  items: NavItem[]
}

const SECTIONS: SectionDef[] = [
  {
    key: 'draft',
    label: 'Draft',
    home: '/draft',
    items: [
      { href: '/draft', label: 'Draft Room', hint: 'Nominate, bid, record a sale' },
      { href: '/board', label: 'Board', hint: 'Who has whom' },
      { href: '/trades', label: 'Trades', hint: 'Players and auction dollars' },
      { href: '/setup', label: 'Setup', hint: 'Order and settings', commishOnly: true },
    ],
  },
  {
    key: 'draft-history',
    label: 'Draft History',
    home: '/history/drafts',
    items: [
      { href: '/history/drafts', label: 'Past Auctions', hint: 'Every draft on record' },
      { href: '/stats', label: 'Spend & Value', hint: 'Where the money went' },
      { href: '/glossary', label: 'Glossary', hint: 'How every number is worked out' },
    ],
  },
  {
    key: 'league-history',
    label: 'League History',
    home: '/history',
    // Listed as they are built: a nav pointing at a 404 makes a section look
    // broken rather than unfinished.
    items: [
      { href: '/history', label: 'League Summary', hint: 'The all-time table' },
      { href: '/history/records', label: 'Records', hint: 'Highs, lows and streaks' },
      { href: '/history/members', label: 'Members', hint: 'One career at a time' },
      { href: '/history/h2h', label: 'Head to Head', hint: 'Everyone against everyone' },
      // Listed under both history sections on purpose: it defines the auction
      // metrics and the league ones, and a third top-level section for one page
      // would undo the reason the top level is three stable words.
      { href: '/glossary', label: 'Glossary', hint: 'How every number is worked out' },
    ],
  },
]

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
  return (
    <nav className="flex flex-wrap items-center gap-x-2 gap-y-1" aria-label="Sections">
      {/*
        The wordmark. The league is FantasyWorld; the auction and the history are
        both things it does, so the name sits above them rather than beside them.
      */}
      <Link
        href="/"
        className="mr-1 font-display text-sm font-bold uppercase tracking-[0.12em] text-slate-100 hover:text-amber-300"
      >
        FantasyWorld
      </Link>

      <ul className="flex flex-wrap items-center gap-0.5">
        {SECTIONS.map((s) => {
          const items = s.items.filter((i) => !i.commishOnly || isCommish)
          const active = s.key === section
          return (
            <li key={s.key} className="group relative">
              <Link
                href={s.home}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.06em] ${
                  active
                    ? 'bg-slate-800 text-slate-50'
                    : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'
                }`}
              >
                {s.label}
                <span aria-hidden className="text-[0.6em] text-slate-500 group-hover:text-slate-300">
                  ▾
                </span>
              </Link>

              {/*
                Opens on hover OR on keyboard focus anywhere inside. `invisible`
                rather than `hidden` so the links stay in the tab order and the
                menu can be reached without a mouse.
              */}
              <div className="invisible absolute left-0 top-full z-50 pt-1 opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                <ul className="min-w-[13rem] border border-rule-strong bg-slate-950 py-1 shadow-xl">
                  {items.map((item) => {
                    const here = current === item.href
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          aria-current={here ? 'page' : undefined}
                          className={`block px-3 py-1.5 ${
                            here ? 'bg-slate-800 text-slate-100' : 'text-slate-300 hover:bg-slate-800/70'
                          }`}
                        >
                          <span className="block text-xs font-semibold">{item.label}</span>
                          {item.hint && (
                            <span className="block text-[0.68rem] leading-tight text-slate-500">
                              {item.hint}
                            </span>
                          )}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
