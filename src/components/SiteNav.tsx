import Link from 'next/link'

/**
 * Three sections, each a disclosure menu.
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
 * ## Why nested menus rather than a flat row
 *
 * A flat row grows one item per feature and never shrinks. Nesting keeps the top
 * level at three stable words, so the shape of the app is legible before you read
 * any of it.
 *
 * ## Why `<details>` rather than the hover menu this used to be
 *
 * ⚠️ **Hover is not an input method every reader has, and the menus were
 * unreachable without it.** The first version opened on `group-hover` plus
 * `group-focus-within`, with the trigger itself a link to the section home. On a
 * touch screen there is no hover and no focus-before-activation, so a tap on
 * "League History" simply navigated to `/history` and the five links underneath
 * it — the Gazette, Records, Members, Head to Head, the glossary — could not be
 * opened at all. The same went for Board and Trades under "Draft". Nothing about
 * that looked broken; the menu just never appeared.
 *
 * That mattered more the moment the draft finished. The auction is a laptop
 * activity one night a year, but the archive and the Gazette are read on a phone
 * all season, which is precisely the reader the nav was failing.
 *
 * `<details>` fixes it by being a real disclosure control rather than a
 * simulation of one. It keeps every property the hover version was built for —
 * **no hooks**, so this renders unchanged in the client draft pages and the
 * server-rendered history pages, and **no JavaScript**, so the menus work while
 * the bundle is still loading, which on draft night is worth having. It adds
 * keyboard operation, `aria-expanded` and the disclosure role for free, none of
 * which the div had.
 *
 * `name` makes the three an exclusive group natively: opening one closes the
 * others, with no state anywhere. Browsers that predate it just allow two open
 * at once, which is untidy rather than broken.
 *
 * **What this gives up, deliberately:** opening now takes a click on desktop
 * where a hover used to do it, and the trigger no longer navigates. Neither is a
 * loss worth engineering around — every section's home page is the *first item*
 * in its own menu (`/draft`, `/history/drafts`, `/history`), so the destination
 * is one row away rather than gone, and one interaction that behaves identically
 * on every input beats two that disagree.
 *
 * `key` includes `current` so a navigation remounts the element and the menu
 * closes behind you. `open` is DOM state that React will not reset on its own,
 * and a menu still hanging open over the page you just asked for reads as a bug.
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
  /**
   * ⚠️ The **first item is the section's home page** — `/draft`,
   * `/history/drafts`, `/history` — and that is load-bearing rather than
   * incidental ordering. The trigger is a disclosure control now, not a link, so
   * this row is the only way to reach the section landing page from the nav.
   * A section whose first item is something else silently loses its front door.
   */
  items: NavItem[]
}

export const SECTIONS: SectionDef[] = [
  {
    key: 'draft',
    label: 'Draft',
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
    items: [
      { href: '/history/drafts', label: 'Past Auctions', hint: 'Every draft on record' },
      { href: '/stats', label: 'Spend & Value', hint: 'Where the money went' },
      { href: '/glossary', label: 'Glossary', hint: 'How every number is worked out' },
    ],
  },
  {
    key: 'league-history',
    label: 'League History',
    // Listed as they are built: a nav pointing at a 404 makes a section look
    // broken rather than unfinished.
    items: [
      { href: '/history', label: 'League Summary', hint: 'The all-time table' },
      { href: '/history/gazette', label: 'The Gazette', hint: 'The week, unkindly' },
      { href: '/history/records', label: 'Records', hint: 'Highs, lows and streaks' },
      { href: '/history/members', label: 'Members', hint: 'One career at a time' },
      { href: '/history/players', label: 'Players', hint: 'Who owned whom, and when' },
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
  /**
   * Omitted on the front page (`/`), which belongs to none of the three and
   * should highlight none of them. `undefined` compares false against every
   * `s.key` below, so no extra branch is needed — and a fourth section value
   * would put a fourth word in a top level whose whole design is three.
   */
  section?: Section
  /** The active pathname, so the current page is marked rather than guessed. */
  current: string
  isCommish?: boolean
}) {
  return (
    // `relative` is the other half of the mobile fix — see the panel below.
    <nav className="relative flex flex-wrap items-center gap-x-2 gap-y-1" aria-label="Sections">
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
            /*
              `static` below `sm`, `relative` above it, and that one word is what
              stops the menu running off the right edge of a phone. The panel is
              positioned against its nearest positioned ancestor: on a narrow
              screen that is the `<nav>`, so the menu spans the nav's width no
              matter which of the three opened it, and on a wider one it is this
              item, so the menu sits under its own trigger as a popover should.
              With `relative` at every width, "League History" — the rightmost
              and longest of the three — opens a 14rem panel starting most of the
              way across a 360px screen, and half of it is unreachable.
            */
            <li key={s.key} className="static sm:relative">
              <details
                /*
                  Remounts on navigation, which closes the menu. React preserves
                  `open` across a client-side route change otherwise, leaving the
                  menu covering the page it was just used to reach.
                */
                key={`${s.key}-${current}`}
                /*
                  Native exclusive accordion: opening one closes the other two,
                  with no state and no effect. Older browsers ignore it and allow
                  two open at once — untidy, not broken.
                */
                name="sitenav"
                className="group"
              >
                <summary
                  /*
                    `aria-current="true"` rather than `"page"`: this is no longer
                    a link and does not point at the current page — it says which
                    of the three sections the reader is inside. The page itself is
                    still marked `"page"` on its row below.
                  */
                  aria-current={active ? 'true' : undefined}
                  className={`flex cursor-pointer list-none items-center gap-1 rounded-md px-2.5 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.06em] select-none [&::-webkit-details-marker]:hidden ${
                    active
                      ? 'bg-slate-800 text-slate-50'
                      : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'
                  }`}
                >
                  {s.label}
                  <span
                    aria-hidden
                    className="text-[0.6em] text-slate-500 transition-transform group-open:rotate-180 group-hover:text-slate-300"
                  >
                    ▾
                  </span>
                </summary>

                <div className="absolute left-0 top-full z-50 w-full pt-1 sm:w-56">
                  <ul className="border border-rule-strong bg-slate-950 py-1 shadow-xl">
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
              </details>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
