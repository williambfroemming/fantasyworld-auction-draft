'use client'

import { useMemo } from 'react'
import {
  draftComplete,
  draftersByPick,
  valueVsRoom,
  type StatsInput,
  type StatsManager,
  type ValuedPick,
} from '@/lib/stats'
import { valueVsResults, type ValuedResult } from '@/lib/draft-value'
import { textOn } from '@/lib/colors'
import { PositionBadge } from '../LotPanel'

function TeamCell({ manager }: { manager?: StatsManager }) {
  return (
    <td className="py-1.5 pl-2 text-right">
      <span
        className="inline-block max-w-[7rem] truncate rounded px-1.5 py-0.5 text-[11px] font-semibold"
        style={{ backgroundColor: manager?.color, color: manager ? textOn(manager.color) : undefined }}
      >
        {manager?.displayName ?? '—'}
      </span>
    </td>
  )
}

function ResultHead() {
  return (
    <thead>
      <tr className="border-b border-rule text-[10px] uppercase tracking-wider text-slate-500">
        <th className="py-2 pr-2 text-left">Player</th>
        <th className="px-2 py-2 text-right">Paid</th>
        <th className="px-2 py-2 text-right">Priced</th>
        <th className="px-2 py-2 text-right">Finished</th>
        <th className="px-2 py-2 text-right">Pts</th>
        <th className="py-2 pl-2 text-right">Team</th>
      </tr>
    </thead>
  )
}

/**
 * One pick, and how the season it bought actually went.
 *
 * "Priced" is where the money slotted this player among the position's drafted
 * players; "Finished" is where they ended up. The gap between those two columns
 * is the whole story, so they sit next to each other and the winner is coloured.
 */
function ResultRow({ v, manager }: { v: ValuedResult; manager?: StatsManager }) {
  const good = v.delta > 0
  return (
    <tr className="border-b border-rule/60">
      <td className="py-1.5 pr-2">
        <span className="flex items-center gap-1.5">
          <PositionBadge position={v.position} />
          <span className="min-w-0 truncate text-sm">{v.name}</span>
        </span>
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">${v.price}</td>
      <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
        {v.position}
        {v.priceRank}
      </td>
      <td
        className={`px-2 py-1.5 text-right tabular-nums font-bold ${
          good ? 'text-emerald-400' : 'text-rose-400'
        }`}
      >
        {v.position}
        {v.finishRank}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{Math.round(v.points)}</td>
      <TeamCell manager={manager} />
    </tr>
  )
}

function ValueHead() {
  return (
    <thead>
      <tr className="border-b border-rule text-[10px] uppercase tracking-wider text-slate-500">
        <th className="py-2 pr-2 text-left">Player</th>
        <th className="px-2 py-2 text-right">Rank</th>
        <th className="px-2 py-2 text-right">Paid</th>
        <th className="px-2 py-2 text-right">Room</th>
        <th className="px-2 py-2 text-right">Diff</th>
        <th className="py-2 pl-2 text-right">Team</th>
      </tr>
    </thead>
  )
}

function ValueRow({ v, manager }: { v: ValuedPick; manager?: StatsManager }) {
  return (
    <tr className="border-b border-rule/60">
      <td className="py-1.5 pr-2">
        <span className="flex items-center gap-1.5">
          <PositionBadge position={v.position} />
          <span className="min-w-0 truncate text-sm">{v.name}</span>
        </span>
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">#{v.rank}</td>
      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">${v.price}</td>
      <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">${v.benchmark}</td>
      <td
        className={`px-2 py-1.5 text-right tabular-nums font-bold ${
          v.delta > 0 ? 'text-rose-400' : 'text-emerald-400'
        }`}
      >
        {v.delta > 0 ? '+' : ''}${v.delta}
      </td>
      <td className="py-1.5 pl-2 text-right">
        <span
          className="inline-block max-w-[7rem] truncate rounded px-1.5 py-0.5 text-[11px] font-semibold"
          style={{ backgroundColor: manager?.color, color: manager ? textOn(manager.color) : undefined }}
        >
          {manager?.displayName ?? '—'}
        </span>
      </td>
    </tr>
  )
}

/**
 * Bargains and overpays, measured against the room's own bidding.
 *
 * ## Why this is gated until the draft is finished
 *
 * The league deliberately stripped tiers and auction values from the board
 * (PROGRESS_LOG step 9b) so that no printed number anchors what people bid. A
 * live "you paid $12 over" readout is that same thing wearing a different hat,
 * and it would be read as a verdict mid-auction. Once every roster is full there
 * is nothing left to anchor, and the same numbers become a recap.
 */
export function ValuePanel({ input, className = '' }: { input: StatsInput; className?: string }) {
  const complete = useMemo(() => draftComplete(input), [input])

  // How the picks actually turned out, where the season has been played. This
  // is the better answer and wins whenever it exists: `valueVsRoom` can only
  // say whether a price beat the room that night, which is all anyone can know
  // ON draft night and much less than anyone wants to know years later.
  const results = useMemo(() => {
    const measured = input.picks.filter((p) => p.points !== null && p.points !== undefined)
    if (measured.length === 0) return null
    // Credited to whoever DRAFTED the player, not whoever owns them now — this
    // is a question about what someone paid, and a trade moves the player
    // without moving the money. Same rule as every other money view here.
    const drafter = draftersByPick(input.picks, input.trades)
    return valueVsResults(
      input.picks.map((p) => ({
        pickId: p.id,
        name: p.name,
        position: p.position,
        price: p.price,
        managerId: drafter.get(p.id) ?? p.managerId,
        points: p.points ?? null,
      })),
      { topN: 8 },
    )
  }, [input.picks, input.trades])

  const report = useMemo(
    () => (complete && !results ? valueVsRoom(input) : null),
    [complete, results, input],
  )
  const byId = useMemo(() => new Map(input.managers.map((m) => [m.id, m])), [input.managers])

  const shell = (children: React.ReactNode) => (
    <div className={`flex min-h-0 flex-col rounded-xl border border-rule bg-slate-900/60 ${className}`}>
      <div className="flex shrink-0 flex-wrap items-baseline gap-2 border-b border-rule px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          Bargains &amp; overpays
        </h2>
        <span className="text-[11px] text-slate-600">
          every price against what this room paid for similar players
        </span>
      </div>
      {children}
    </div>
  )

  if (!complete) {
    const filled = input.managers.reduce((s, m) => s + m.rostered, 0)
    const total = input.managers.length * input.rosterSize
    // An explanatory empty state, not a hidden tab: a tab that vanishes reads
    // as a bug, and the reason it is unavailable is the interesting part.
    return shell(
      <div className="grid flex-1 place-items-center p-8 text-center">
        <div className="max-w-md">
          <p className="text-lg text-slate-300">Available when the draft is done.</p>
          <p className="mt-2 text-sm text-slate-500">
            Bargains and overpays are only meaningful against a finished market — and a live
            &ldquo;you overpaid&rdquo; readout is the same anchoring the league removed tiers
            and auction values to avoid.
          </p>
          <p className="mt-3 text-xs uppercase tracking-widest text-slate-600">
            {filled} of {total} slots filled
          </p>
        </div>
      </div>,
    )
  }

  // The results view, whenever the season has been played.
  if (results) {
    const { steals, busts, byManager: netByManager, unscored: unmeasured } = results
    const most = Math.max(1, ...netByManager.map((b) => Math.abs(b.delta)))
    return shell(
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <p className="mb-3 text-[11px] leading-relaxed text-slate-500">
          What each pick cost against where the player actually finished that season, within their
          own position. A $1 receiver who ends the year WR4 is a steal; a $47 back who ends it RB44
          is not.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-emerald-400/80">
              Steals
            </h3>
            <table className="w-full">
              <ResultHead />
              <tbody>
                {steals.map((v) => (
                  <ResultRow key={v.pickId} v={v} manager={byId.get(v.managerId)} />
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-rose-400/80">
              Busts
            </h3>
            <table className="w-full">
              <ResultHead />
              <tbody>
                {busts.map((v) => (
                  <ResultRow key={v.pickId} v={v} manager={byId.get(v.managerId)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <h3 className="mb-1 mt-5 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
          Places gained on what they paid, by team
        </h3>
        <table className="w-full text-sm">
          <tbody>
            {netByManager.map((b) => {
              const m = byId.get(b.managerId)
              return (
                <tr key={b.managerId} className="border-b border-rule/60">
                  <td className="py-1.5 pr-2">
                    <span
                      className="inline-block max-w-[9rem] truncate rounded px-1.5 py-0.5 text-[11px] font-semibold"
                      style={{ backgroundColor: m?.color, color: m ? textOn(m.color) : undefined }}
                    >
                      {m?.displayName ?? '—'}
                    </span>
                  </td>
                  <td className="w-full px-2 py-1.5">
                    <span className="flex items-center" aria-hidden>
                      <span
                        className={`h-2 ${b.delta >= 0 ? 'bg-emerald-500/70' : 'bg-rose-500/70'}`}
                        style={{ width: `${(Math.abs(b.delta) / most) * 100}%` }}
                      />
                    </span>
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right tabular-nums font-bold ${
                      b.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {b.delta > 0 ? '+' : ''}
                    {b.delta}
                  </td>
                  <td className="py-1.5 pl-2 text-right text-[11px] tabular-nums text-slate-600">
                    {b.scored} picks
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {unmeasured > 0 && (
          <p className="mt-3 text-[11px] text-slate-600">
            {unmeasured} pick{unmeasured === 1 ? '' : 's'} have no season on record and are left out
            rather than scored zero.
          </p>
        )}
      </div>,
    )
  }

  const { scored, unscored, byManager } = report!

  if (scored.length === 0) {
    // A finished season with no ranks on record — every pre-2026 auction, whose
    // pool was replaced long before `picks.player_rank` existed. Two empty
    // tables would read as a bug; the reason is the interesting part, and it is
    // not recoverable.
    return shell(
      <div className="grid flex-1 place-items-center p-8 text-center">
        <div className="max-w-md">
          <p className="text-lg text-slate-300">Not scored for {input.season}.</p>
          <p className="mt-2 text-sm text-slate-500">
            Once the season is played, every pick is scored against where the player actually
            finished. Until then it can only be compared to what the room paid for similarly ranked
            players &mdash; and this season has no pool rankings on record, which stops being
            recoverable the moment a pool is replaced each August.
          </p>
          <p className="mt-3 text-xs uppercase tracking-widest text-slate-600">
            {unscored} pick{unscored === 1 ? '' : 's'} unranked
          </p>
        </div>
      </div>,
    )
  }

  const overpays = scored.slice(0, 8)
  const bargains = [...scored].reverse().slice(0, 8)

  return shell(
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-rose-400/80">
            Paid over the room
          </h3>
          <table className="w-full">
            <ValueHead />
            <tbody>
              {overpays.map((v) => (
                <ValueRow key={v.pickId} v={v} manager={byId.get(v.managerId)} />
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-emerald-400/80">
            Got them under
          </h3>
          <table className="w-full">
            <ValueHead />
            <tbody>
              {bargains.map((v) => (
                <ValueRow key={v.pickId} v={v} manager={byId.get(v.managerId)} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h3 className="mb-1 mt-5 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
        Net against the room, by team
      </h3>
      <table className="w-full text-sm">
        <tbody>
          {[...byManager]
            .sort((a, b) => a.delta - b.delta)
            .map((b) => {
              const m = byId.get(b.managerId)
              return (
                <tr key={b.managerId} className="border-b border-rule/60">
                  <td className="py-1.5 pr-2">
                    <span
                      className="inline-block max-w-[9rem] truncate rounded px-1.5 py-0.5 text-xs font-semibold"
                      style={{ backgroundColor: m?.color, color: m ? textOn(m.color) : undefined }}
                    >
                      {m?.displayName ?? b.managerId}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">
                    {b.scored} scored
                  </td>
                  <td
                    className={`py-1.5 pl-2 text-right tabular-nums font-bold ${
                      b.delta > 0 ? 'text-rose-400' : 'text-emerald-400'
                    }`}
                  >
                    {b.delta > 0 ? '+' : ''}${b.delta.toFixed(0)}
                  </td>
                </tr>
              )
            })}
        </tbody>
      </table>

      <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
        The benchmark is <span className="text-slate-500">this room&apos;s own bidding</span>,
        deliberately — no third-party auction values, which the league removed from the board
        on purpose. Each price is compared to the median the room paid for the nearest-ranked
        players <span className="text-slate-500">at the same position</span>; comparing across
        positions would only rediscover that this is a superflex league. So it can tell you
        who paid more than the room did for a comparable player — it cannot tell you the room
        was right. If everyone overpaid for running backs, nothing here will say so.
        {unscored > 0 && ` ${unscored} pick${unscored === 1 ? '' : 's'} had no rank on record and ${unscored === 1 ? 'is' : 'are'} not scored.`}
      </p>
    </div>,
  )
}
