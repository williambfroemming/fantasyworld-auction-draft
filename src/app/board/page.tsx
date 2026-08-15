'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { LeagueBoard } from '@/components/LeagueBoard'
import { MarketPanel } from '@/components/MarketPanel'
import { useDraft } from '@/hooks/useDraft'
import type { ArchiveSeason, SeasonSummary } from '@/server/archive-service'

/**
 * The League board on its own page, for the live draft and for every past one.
 *
 * Deliberately separate from /draft: during bidding the only thing that matters
 * is the player on the block, and a 10-column grid competing for attention made
 * both worse. People come here between picks.
 *
 * The season picker lives here rather than on /draft for the same reason — this
 * is already the wide, dense, "study the board" screen, and browsing 2026 is a
 * between-picks activity by definition. Picking a past year swaps in a
 * read-only archive: same grid, no nominate, no award, and it stops polling.
 */
export default function BoardPage() {
  const { state, board } = useDraft()

  const [seasons, setSeasons] = useState<SeasonSummary[]>([])
  /** null = the season being drafted now, i.e. the live board. */
  const [viewing, setViewing] = useState<number | null>(null)
  const [view, setView] = useState<'grid' | 'market'>('grid')

  // Both results carry the season they belong to, so switching tabs needs no
  // "clear the old one" setState in the effect body — a stale result simply
  // stops matching `viewing` and is ignored. Same reason the fetch is keyed
  // rather than cancelled-and-blanked.
  const [loaded, setLoaded] = useState<ArchiveSeason | null>(null)
  const [failed, setFailed] = useState<{ season: number; message: string } | null>(null)

  useEffect(() => {
    fetch('/api/archive', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setSeasons(d.seasons ?? []))
      .catch(() => {})
  }, [])

  // Fetched once per selection, not polled: a finished draft does not change.
  useEffect(() => {
    if (viewing === null) return
    let alive = true
    fetch(`/api/archive?season=${viewing}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? 'Could not load that season')
        return r.json()
      })
      .then((d) => alive && setLoaded(d))
      .catch((e) => alive && setFailed({ season: viewing, message: e.message }))
    return () => {
      alive = false
    }
  }, [viewing])

  const archive = loaded && loaded.season === viewing ? loaded : null
  const archiveError = failed && failed.season === viewing ? failed.message : null

  if (!state) {
    return <main className="grid min-h-dvh place-items-center bg-slate-950 text-slate-400">Loading…</main>
  }

  const lot = state.lot
  const onClock = state.managers.find((m) => m.id === state.onTheClock?.managerId)
  const isArchive = viewing !== null
  const past = seasons.filter((s) => !s.isCurrent)

  return (
    <main className="flex h-dvh flex-col bg-slate-950 text-slate-100">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-800 px-4 py-2.5">
        <Link
          href="/draft"
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold hover:bg-slate-700"
        >
          ← Back to draft
        </Link>
        {/* Grid vs market: two ways of reading the same draft. The grid is who
            has whom; the market is what the money has been going to. */}
        <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-1">
          {(
            [
              ['grid', 'Board'],
              ['market', 'Market'],
            ] as const
          ).map(([key, label]) => (
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

        {/* The year picker. Shown as soon as any season is on record, even
            before there is a second one: with an archive in play, "which year
            am I looking at" is a real question, and the current-season tab
            answers it. */}
        {seasons.length > 0 && (
          <div className="flex items-center gap-1 rounded-lg bg-slate-900 p-1">
            <SeasonTab
              label={`${state.draft.season}`}
              sub="live"
              active={!isArchive}
              onClick={() => setViewing(null)}
            />
            {past.map((s) => (
              <SeasonTab
                key={s.season}
                label={`${s.season}`}
                sub={`${s.picks} picks`}
                active={viewing === s.season}
                onClick={() => setViewing(s.season)}
              />
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          {isArchive ? (
            <>
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-300">
                Archived · read only
              </span>
              <a
                href={`/api/export?season=${viewing}`}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm font-semibold hover:bg-slate-700"
              >
                Export CSV
              </a>
            </>
          ) : lot ? (
            <span className="flex items-center gap-2 text-sm text-slate-300">
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-300">
                On the block
              </span>
              <span className="font-semibold">{lot.playerName}</span>
            </span>
          ) : (
            <span className="text-sm text-slate-400">
              On the clock:{' '}
              <span className="font-semibold" style={{ color: onClock?.color }}>
                {onClock?.displayName ?? '—'}
              </span>
            </span>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 p-3">
        {!isArchive ? (
          view === 'grid' ? (
            <LeagueBoard managers={state.managers} board={board} className="h-full" />
          ) : (
            <MarketPanel
              rosters={board?.rosters ?? []}
              pool={board?.pool ?? []}
              className="h-full"
            />
          )
        ) : archiveError ? (
          <div className="grid h-full place-items-center text-slate-400">{archiveError}</div>
        ) : !archive ? (
          <div className="grid h-full place-items-center text-slate-500">Loading {viewing}…</div>
        ) : view === 'grid' ? (
          <LeagueBoard
            managers={archive.managers}
            board={archive}
            title={`${archive.season} draft`}
            className="h-full"
          />
        ) : (
          // No pool for a finished season — "what's left at WR" is not a
          // question a completed draft has an answer to.
          <MarketPanel rosters={archive.rosters} className="h-full" />
        )}
      </div>
    </main>
  )
}

function SeasonTab({
  label,
  sub,
  active,
  onClick,
}: {
  label: string
  sub: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-left leading-tight ${
        active ? 'bg-slate-700 text-slate-100' : 'text-slate-400 hover:bg-slate-800'
      }`}
    >
      <span className="block text-xs font-semibold tabular-nums">{label}</span>
      <span className="block text-[10px] opacity-70">{sub}</span>
    </button>
  )
}
