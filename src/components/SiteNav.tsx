import Link from 'next/link'

/**
 * The top bar: the wordmark, then three items, each answering one question a
 * member actually has (docs/SITE_STRUCTURE.md).
 *
 *   The Gazette — "what happened this week?"  A direct link: one destination.
 *   History ▾   — "what happened in past seasons?"  Records, careers, matchups.
 *   Auction ▾   — "who paid what?"  This year's draft tools, then past auctions.
 *
 * ## Why this shape, and not the three menus it replaced
 *
 * The previous cut was Draft · Draft History · League History, and League
 * History became a catch-all of ten links. Three things were wrong with it:
 *
 *  - **The Gazette was buried** fifth in a menu, and it is the one page members
 *    read every week. It is now a top-level link that needs no menu at all.
 *  - **The live draft held a top-level slot all year** for a tool used one night
 *    in August. It now shares the Auction menu with the auction archive, as the
 *    "This year" group — the same question ("who paid what") asked of the
 *    present rather than the past.
 *  - **The Oracle was a destination**, so asking about a page meant leaving it.
 *    It is now a launcher on the right of the header (`OracleLauncher`, drawn by
 *    `HeaderControls`), with its full page at `/oracle` one click from the panel.
 *    The Glossary, listed twice before, now lives once, in the account menu.
 *
 * History holds only past seasons, seven items rather than ten.
 *
 * ## Why nested menus rather than a flat row
 *
 * A flat row grows one item per feature and never shrinks. Nesting keeps the top
 * level at three stable words, so the shape of the app is legible before you read
 * any of it. A section only becomes a direct link when it has one destination;
 * giving the Gazette a one-row menu would be a click spent for nothing.
 *
 * ## Why `<details>` rather than the hover menu this used to be
 *
 * ⚠️ **Hover is not an input method every reader has, and the menus were
 * unreachable without it.** The first version opened on `group-hover` plus
 * `group-focus-within`, with the trigger itself a link to the section home. On a
 * touch screen there is no hover and no focus-before-activation, so a tap on the
 * trigger simply navigated and the links underneath it could not be opened at
 * all. Nothing about that looked broken; the menu just never appeared — and the
 * archive and the Gazette are read on a phone all season.
 *
 * `<details>` fixes it by being a real disclosure control rather than a
 * simulation of one. It keeps every property the hover version was built for —
 * **no hooks**, so this renders unchanged in the client draft pages and the
 * server-rendered history pages, and **no JavaScript**, so the menus work while
 * the bundle is still loading, which on draft night is worth having. It adds
 * keyboard operation, `aria-expanded` and the disclosure role for free.
 *
 * `name` makes the menus an exclusive group natively: opening one closes the
 * other, with no state anywhere. Browsers that predate it just allow two open at
 * once, which is untidy rather than broken.
 *
 * **What this gives up, deliberately:** opening takes a click on desktop, and a
 * menu trigger does not navigate. Every menu's home page is therefore the *first
 * item* in its own menu (`/history`, `/draft`), so the destination is one row
 * away rather than gone.
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

export type Section = 'gazette' | 'history' | 'auction'

export interface NavItem {
  href: string
  label: string
  hint?: string
  /** Drawn only for the commissioner. Never a security boundary. */
  commishOnly?: boolean
}

interface NavGroup {
  /** A small-caps header inside the panel. Omitted for a menu of one group. */
  label?: string
  items: NavItem[]
}

/** A section with one destination: drawn as a link styled like a menu trigger. */
interface LinkSection {
  key: Section
  label: string
  href: string
}

/** A section with several destinations: drawn as a `<details>` menu. */
interface MenuSection {
  key: Section
  label: string
  /**
   * ⚠️ The **first item of the first group is the section's home page** —
   * `/history`, `/draft` — and that is load-bearing rather than incidental
   * ordering. The trigger is a disclosure control, not a link, so this row is
   * the only way to reach the section landing page from the nav. A section whose
   * first item is something else silently loses its front door.
   */
  groups: NavGroup[]
}

export type SectionDef = LinkSection | MenuSection

export function isMenu(s: SectionDef): s is MenuSection {
  return 'groups' in s
}

export const SECTIONS: SectionDef[] = [
  { key: 'gazette', label: 'The Gazette', href: '/gazette' },
  {
    key: 'history',
    label: 'History',
    // Past seasons only. Listed as they are built: a nav pointing at a 404 makes
    // a section look broken rather than unfinished.
    groups: [
      {
        items: [
          { href: '/history', label: 'League Summary', hint: 'The all-time table' },
          { href: '/history/records', label: 'Records', hint: 'Highs, lows and streaks' },
          { href: '/history/members', label: 'Members', hint: 'One career at a time' },
          { href: '/history/players', label: 'Players', hint: 'Who owned whom, and when' },
          { href: '/history/h2h', label: 'Head to Head', hint: 'Everyone against everyone' },
          { href: '/history/by-week', label: 'Record by Week', hint: 'Who got in from where' },
          { href: '/history/charts', label: 'Charts', hint: 'The league, drawn' },
        ],
      },
    ],
  },
  {
    key: 'auction',
    label: 'Auction',
    groups: [
      {
        label: 'This year',
        items: [
          { href: '/draft', label: 'Draft Room', hint: 'Nominate, bid, record a sale' },
          { href: '/board', label: 'Board', hint: 'Who has whom' },
          { href: '/trades', label: 'Trades', hint: 'Players and auction dollars' },
        ],
      },
      {
        label: 'Past auctions',
        items: [
          { href: '/history/drafts', label: 'Archive', hint: 'Every draft on record' },
          { href: '/stats', label: 'Spend & Value', hint: 'Where the money went' },
        ],
      },
    ],
  },
]

/**
 * Pages with no slot in the bar: the Oracle (reached from its launcher) and the
 * Glossary (from the account menu). Exported so the front page's index can list
 * them without retyping a label or a path.
 */
export const OFF_BAR: NavItem[] = [
  { href: '/oracle', label: 'Ask the Oracle', hint: 'Any question, from the record' },
  { href: '/glossary', label: 'Glossary', hint: 'How every number is worked out' },
]

/** Every item of a section, groups flattened, in menu order. */
export function sectionItems(s: SectionDef): NavItem[] {
  return isMenu(s) ? s.groups.flatMap((g) => g.items) : [{ href: s.href, label: s.label }]
}

const TRIGGER =
  'flex cursor-pointer list-none items-center gap-1 rounded-md px-2.5 py-1.5 font-display text-xs font-semibold uppercase tracking-[0.06em] select-none [&::-webkit-details-marker]:hidden'
const TRIGGER_ACTIVE = 'bg-slate-800 text-slate-50'
const TRIGGER_IDLE = 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'

export function SiteNav({
  section,
  current,
  isCommish = false,
}: {
  /**
   * Omitted on the front page (`/`) and the glossary, which belong to none of
   * the three and should highlight none of them. `undefined` compares false
   * against every `s.key` below, so no extra branch is needed.
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
          const active = s.key === section

          if (!isMenu(s)) {
            return (
              <li key={s.key}>
                <Link
                  href={s.href}
                  /*
                    `"page"` only on the section's own index; on an issue page
                    the link is the section the reader is inside, which is
                    `"true"` — the same distinction the menus draw below.
                  */
                  aria-current={current === s.href ? 'page' : active ? 'true' : undefined}
                  className={`${TRIGGER} ${active ? TRIGGER_ACTIVE : TRIGGER_IDLE}`}
                >
                  {s.label}
                </Link>
              </li>
            )
          }

          const groups = s.groups
            .map((g) => ({ ...g, items: g.items.filter((i) => !i.commishOnly || isCommish) }))
            .filter((g) => g.items.length > 0)
          return (
            /*
              `static` below `sm`, `relative` above it, and that one word is what
              stops the menu running off the right edge of a phone. The panel is
              positioned against its nearest positioned ancestor: on a narrow
              screen that is the `<nav>`, so the menu spans the nav's width no
              matter which trigger opened it, and on a wider one it is this item,
              so the menu sits under its own trigger as a popover should. With
              `relative` at every width, the rightmost menu opens a 14rem panel
              starting most of the way across a 360px screen, and half of it is
              unreachable.
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
                  Native exclusive accordion: opening one closes the other, with
                  no state and no effect. Older browsers ignore it and allow two
                  open at once — untidy, not broken.
                */
                name="sitenav"
                className="group"
              >
                <summary
                  /*
                    `aria-current="true"` rather than `"page"`: this is not a link
                    and does not point at the current page — it says which section
                    the reader is inside. The page itself is still marked `"page"`
                    on its row below.
                  */
                  aria-current={active ? 'true' : undefined}
                  className={`${TRIGGER} ${active ? TRIGGER_ACTIVE : TRIGGER_IDLE}`}
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
                  <div className="border border-rule-strong bg-slate-950 py-1 shadow-xl">
                    {groups.map((g, gi) => (
                      <div key={g.label ?? gi} className={gi > 0 ? 'mt-1 border-t border-rule pt-1' : undefined}>
                        {g.label && (
                          <p className="px-3 pt-1.5 pb-0.5 font-display text-[0.6rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
                            {g.label}
                          </p>
                        )}
                        <ul aria-label={g.label}>
                          {g.items.map((item) => {
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
                    ))}
                  </div>
                </div>
              </details>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
