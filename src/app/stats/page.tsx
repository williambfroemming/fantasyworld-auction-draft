'use client'

import Link from 'next/link'
import { SiteNav } from '@/components/SiteNav'
import { useSession } from '@/hooks/useSession'
import { useMemo, useState } from 'react'
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
 */
export default function StatsPage() {
  const { state, board } = useDraft()
  const { managerId } = useSession()
  const { seasons, viewing, setViewing, isArchive, archive, archiveError } = useSeasonView()
  const [view, setView] = useState<View>('teams')

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
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav section="draft" current="/stats" isCommish={myManager?.isCommish} />

        <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-1">
          {VIEWS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setView(key)}
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

        <Link
          href="/board"
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
        >
          League board →
        </Link>

        <div className="ml-auto flex items-center gap-3">
          <ThemeToggle />
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
      </header>

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
