'use client'

import { useEffect, useState } from 'react'
import type { NewsItem } from '@/lib/news'
import type { PlayerInjuryView } from '@/hooks/useDraft'
import { InjuryBadge } from './InjuryBadge'
import { PositionBadge } from './LotPanel'

/**
 * Everything known about one player, in a panel that can be wrong about nothing.
 *
 * §1's original design worried about a click collision: a row click already
 * means "nominate", and rows are disabled when it is not your turn — which is
 * precisely when you want to read about somebody. §4 settled the pattern: the
 * affordance is a **sibling button** that stays live while the row is disabled.
 * This drawer is what it opens, and it has three entry points (pool row, open
 * lot, League board) rather than three components.
 *
 * ## Injury is instant; headlines arrive if they arrive
 *
 * The injury block renders from data the caller already had — a stored column,
 * no fetch — so the panel is useful the moment it opens even with the network
 * on fire. Headlines are fetched after, and their absence is drawn as absence.
 */
export function PlayerDrawer({
  player,
  onClose,
}: {
  player: { name: string; team: string | null; position: string; injury: PlayerInjuryView | null } | null
  onClose: () => void
}) {
  /**
   * One state object tagged with the player it belongs to, rather than a
   * separate `loading` flag reset at the top of the effect.
   *
   * Resetting in the effect body is a synchronous setState during render's
   * commit and cascades — Next 16's `react-hooks/set-state-in-effect` rejects
   * it. Tagging instead means "loading" is *derived*: a result for a different
   * player is simply not this player's result, so opening a second drawer can
   * never flash the first player's headlines under the second player's name.
   */
  const [result, setResult] = useState<{
    forName: string
    items: NewsItem[]
    degraded: boolean
  } | null>(null)
  const name = player?.name

  useEffect(() => {
    if (!name) return
    let alive = true
    fetch(`/api/news?player=${encodeURIComponent(name)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive) {
          setResult({ forName: name, items: d?.items ?? [], degraded: Boolean(d?.degraded) })
        }
      })
      // Offline, or the route itself failed. An empty panel, never an error —
      // the auction is not waiting on this.
      .catch(() => {
        if (alive) setResult({ forName: name, items: [], degraded: true })
      })
    return () => {
      alive = false
    }
  }, [name])

  const loaded = result && result.forName === name ? result : null
  const news = loaded?.items ?? null
  const degraded = loaded?.degraded ?? false

  // Escape closes, because this opens over a screen people are working in.
  useEffect(() => {
    if (!player) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [player, onClose])

  if (!player) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true"
         aria-label={`Details for ${player.name}`}>
      <button
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-label="Close player details"
        tabIndex={-1}
      />

      <aside className="relative flex h-full w-full max-w-md flex-col overflow-auto border-l border-rule bg-slate-900 shadow-2xl">
        <header className="flex items-start gap-2 border-b border-rule p-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <PositionBadge position={player.position} />
              <span className="text-sm text-slate-400">{player.team ?? 'FA'}</span>
              <InjuryBadge injury={player.injury} size="lg" />
            </div>
            <h2 className="mt-1 truncate text-2xl font-bold tracking-tight">{player.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-slate-800"
          >
            Close
          </button>
        </header>

        {/* ---- availability: no fetch, always here ---- */}
        <section className="border-b border-rule p-4">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            Availability
          </h3>
          {player.injury ? (
            <dl className="space-y-1 text-sm">
              <Row label="Status" value={player.injury.status} />
              <Row label="Detail" value={player.injury.bodyPart} />
              <Row label="Practice" value={player.injury.practice} />
              <Row label="Note" value={player.injury.notes} />
              {player.injury.updatedAt && (
                <p className="pt-1 text-[11px] text-slate-600">
                  as of {new Date(player.injury.updatedAt).toLocaleString()} ·{' '}
                  <code className="text-slate-500">npm run news:refresh</code>
                </p>
              )}
            </dl>
          ) : (
            /* Says "nothing reported", never "healthy". The pool may simply
               never have been refreshed, and claiming fitness we cannot back up
               is the one wrong answer this feature must not give. */
            <p className="text-sm text-slate-500">
              Nothing reported. That means no injury on file — not a clean bill of health.
            </p>
          )}
        </section>

        {/* ---- headlines: best effort ---- */}
        <section className="p-4">
          <h3 className="mb-2 flex items-baseline gap-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            Recent news
            {degraded && <span className="font-normal normal-case text-slate-600">· feed unavailable</span>}
          </h3>

          {news === null ? (
            <p className="text-sm text-slate-600">Loading…</p>
          ) : news.length === 0 ? (
            <p className="text-sm text-slate-500">
              {degraded
                ? 'The news feed could not be reached. Everything else on this page is still accurate.'
                : 'No recent headlines mention this player.'}
            </p>
          ) : (
            <ul className="space-y-3">
              {news.map((n, i) => (
                <li key={`${n.url ?? n.headline}-${i}`} className="border-b border-rule/60 pb-3 last:border-0">
                  <a
                    href={n.url ?? '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold hover:underline"
                  >
                    {n.headline}
                  </a>
                  {n.summary && <p className="mt-0.5 text-xs text-slate-400">{n.summary}</p>}
                  <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-600">
                    {n.source} · {new Date(n.published).toLocaleDateString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  )
}

// Hoisted to module scope: Next 16's react-hooks/static-components rule rejects
// component definitions nested inside another component's body.
function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="flex gap-2">
      <dt className="w-20 shrink-0 text-[11px] uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="min-w-0 flex-1">{value}</dd>
    </div>
  )
}
