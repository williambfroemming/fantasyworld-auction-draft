'use client'

import { SiteNav } from '@/components/SiteNav'
import { useSession } from '@/hooks/useSession'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useMemo } from 'react'
import { SeasonPicker } from '@/components/SeasonPicker'
import { CurvePanel } from '@/components/stats/CurvePanel'
import { NominationsPanel } from '@/components/stats/NominationsPanel'
import { PacePanel } from '@/components/stats/PacePanel'
import { TeamSpendPanel } from '@/components/stats/TeamSpendPanel'
import { ValuePanel } from '@/components/stats/ValuePanel'
import { useDraft } from '@/hooks/useDraft'
import { useSeasonView } from '@/hooks/useSeasonView'
import type { StatsInput } from '@/lib/stats'
import { ThemeToggle } from '@/components/ThemeToggle'

type View = 'teams' | 'pace' | 'curve' | 'nominations' | 'value'

const VIEWS = [
  ['teams', 'Teams'],
  ['pace', 'Pace'],
  ['curve', 'Curve'],
  ['nominations', 'Nominations'],
  ['value', 'Value'],
] as const

const VIEW_KEYS = VIEWS.map(([k]) => k) as readonly string[]

function parseView(raw: string | null): View {
  return raw !== null && VIEW_KEYS.includes(raw) ? (raw as View) : 'teams'
}

/**
 * ⚠️ `useSearchParams` — used here and inside `useSeasonView` — bails the tree
 * out of prerendering up to the nearest `<Suspense>`, and Next 16 fails the
 * build without one. `next dev` renders on demand and will not complain, so
 * this boundary is only ever defended by `npm run build`.
 */
export default function StatsPage() {
  return (
    <Suspense
      fallback={<main className="grid min-h-dvh place-items-center bg-slate-950 text-slate-400">Loading…</main>}
    >
      <StatsView />
    </Suspense>
  )
}

/**
 * Spend analysis — the draft read back as numbers.
 *
 * Its own page rather than more tabs on /board: that screen is about *who has
 * whom*, and these are dense enough to want the whole width. It updates on the
 * same poll as everything else, so it is live all night.
 *
 * The live season and any archived one go through **one code path**: both are
 * adapted into a `StatsInput` below and every panel underneath is
 * season-agnostic. A bug therefore cannot hide in only one of them.
 *
 * ## The header is two rows, and which row a control sits on is the point
 *
 * It used to be one: site nav, five view tabs, a tab per season, a link to
 * /board, a theme toggle and a pick count, all at the same weight, and nothing
 * saying which of them was the page and which was the context. Row one is now
 * the site nav and nothing else — identical to every history page, so the top
 * of the app stops changing shape as you move around it. Row two is this page:
 * what it is, which view, which year.
 *
 * Both the view and the season live in the query string, so a tab is a link
 * somebody can send.
 */
function StatsView() {
  const { state, board } = useDraft()
  const { managerId } = useSession()
  const { seasons, viewing, setViewing, isArchive, archive, archiveError } = useSeasonView()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const view = parseView(searchParams.get('view'))

  const setView = (next: View) => {
    const params = new URLSearchParams(searchParams.toString())
    // 'teams' is the default, so it stays out of the URL — a bare /stats and
    // /stats?view=teams should not be two different-looking links to one page.
    if (next === 'teams') params.delete('view')
    else params.set('view', next)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const input: StatsInput | null = useMemo(() => {
    if (isArchive) {
      return archive
        ? {
            season: archive.season,
            rosterSize: archive.rosterSize,
            startingBudget: archive.startingBudget,
            isFinal: archive.isFinal,
            managers: archive.managers,
            picks: archive.rosters,
            trades: archive.trades,
          }
        : null
    }
    return state && board
      ? {
          season: state.draft.season,
          rosterSize: state.draft.rosterSize,
          startingBudget: state.draft.startingBudget,
          managers: state.managers,
          picks: board.rosters,
          trades: board.trades,
        }
      : null
  }, [isArchive, archive, state, board])

  const myManager = state?.managers.find((m) => m.id === managerId)

  if (!state) {
    return <main className="grid min-h-dvh place-items-center bg-slate-950 text-slate-400">Loading…</main>
  }

  return (
    <main className="flex h-dvh flex-col bg-slate-950 text-slate-100">
      {/* Row 1 — where you are in the app. Same shape as every history page. */}
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav section="draft-history" current="/stats" isCommish={myManager?.isCommish} />
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      {/* Row 2 — this page: what it is, which view, which year. */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-rule px-4 py-2">
        <h1 className="font-display text-lg font-bold uppercase tracking-[0.08em]">
          Spend &amp; Value
        </h1>

        <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-1">
          {VIEWS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
              aria-current={view === key ? 'page' : undefined}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                view === key ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <SeasonPicker
          liveSeason={state.draft.season}
          seasons={seasons}
          viewing={viewing}
          onSelect={setViewing}
        />

        <div className="ml-auto">
          {isArchive ? (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-300">
              Archived · read only
            </span>
          ) : (
            <span className="text-sm text-slate-400">
              {input?.picks.length ?? 0} of {state.managers.length * state.draft.rosterSize} picks
            </span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 p-3">
        {archiveError ? (
          <div className="grid h-full place-items-center text-slate-400">{archiveError}</div>
        ) : !input ? (
          <div className="grid h-full place-items-center text-slate-500">
            {isArchive ? `Loading ${viewing}…` : 'Loading…'}
          </div>
        ) : view === 'teams' ? (
          <TeamSpendPanel input={input} className="h-full" />
        ) : view === 'pace' ? (
          <PacePanel input={input} className="h-full" />
        ) : view === 'curve' ? (
          <CurvePanel input={input} className="h-full" />
        ) : view === 'nominations' ? (
          <NominationsPanel input={input} className="h-full" />
        ) : (
          <ValuePanel input={input} className="h-full" />
        )}
      </div>
    </main>
  )
}
