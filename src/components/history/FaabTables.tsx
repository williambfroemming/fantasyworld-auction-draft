import { GlossaryLink } from '@/components/GlossaryLink'
import { managerColor } from '@/lib/colors'
import type { FaabClaim, FaabSeason, LostBid } from '@/lib/faab'
import type { HistoryMember } from '@/lib/history'

/**
 * One season of waiver money and claims. Every table is plain text first; nothing here relies
 * on colour alone. Points are regular season, started, and are blank (never 0) when the season
 * has no weekly data.
 */

const dash = <span className="text-slate-600">—</span>
const pts = (v: number | null) => (v === null ? dash : v.toFixed(1))

function Who({ id, members }: { id: number | null; members: HistoryMember[] }) {
  const m = members.find((x) => x.managerId === id)
  if (!m) return dash
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        aria-hidden
        className="h-2.5 w-1 self-center"
        style={{ backgroundColor: managerColor(m.color) }}
      />
      <span className="font-semibold">{m.displayName}</span>
    </span>
  )
}

function Heading({
  children,
  anchor,
  label,
}: {
  children: React.ReactNode
  anchor?: string
  label?: string
}) {
  return (
    <h3 className="mb-2 flex items-baseline gap-2 border-b border-rule-strong pb-1.5 font-display text-sm font-bold uppercase tracking-[0.1em]">
      {children}
      {anchor && <GlossaryLink anchor={anchor} label={label ?? String(children)} />}
    </h3>
  )
}

function Th({ children, left }: { children: React.ReactNode; left?: boolean }) {
  return (
    <th scope="col" className={`px-2 py-2 font-display ${left ? 'text-left' : 'text-right'}`}>
      {children}
    </th>
  )
}

export function FaabMoneyTable({ faab, members }: { faab: FaabSeason; members: HistoryMember[] }) {
  const rows = [...faab.managers].sort((a, b) => b.remaining - a.remaining)
  return (
    <section className="min-w-0">
      <Heading anchor="faab-remaining" label="FAAB">
        FAAB, manager by manager
      </Heading>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Waiver money spent and left, and claims won and lost, one row per manager.
          </caption>
          <thead>
            <tr className="border-b border-rule-strong text-[0.62rem] uppercase tracking-[0.06em] text-slate-400">
              <Th left>Manager</Th>
              <Th>Left</Th>
              <Th>Spent</Th>
              <Th>Traded</Th>
              <Th>Won</Th>
              <Th>Lost</Th>
              <Th>$0 wins</Th>
              <Th>Pts / $</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const net = r.received - r.sent
              return (
                <tr key={r.managerId} className="border-b border-rule/60">
                  <th scope="row" className="px-2 py-1.5 text-left">
                    <Who id={r.managerId} members={members} />
                  </th>
                  <td className="px-2 py-1.5 text-right font-mono text-xs font-semibold tabular-nums">
                    ${r.remaining}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                    ${r.spent}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-400">
                    {net === 0 ? dash : `${net > 0 ? '+' : '−'}$${Math.abs(net)}`}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">{r.won}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-400">
                    {r.lost}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums text-slate-400">
                    {r.freeWins}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-xs tabular-nums">
                    {r.pointsPerDollar === null ? dash : r.pointsPerDollar.toFixed(2)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Spent counts completed claims only. Traded is FAAB moved in trades. Pts / $ is started
        points, regular season, from paid claims over dollars spent; a $0 claim has none.
      </p>
    </section>
  )
}

function ClaimRows({
  claims,
  members,
  showShort,
}: {
  claims: FaabClaim[]
  members: HistoryMember[]
  showShort?: boolean
}) {
  return (
    <ol className="space-y-2">
      {claims.map((c, i) => (
        <li key={`${c.managerId}-${c.week}-${c.playerId}-${i}`} className="text-sm">
          <div className="leaders">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="w-3 shrink-0 font-mono text-xs text-slate-500 tabular-nums">
                {i + 1}
              </span>
              <span className="font-semibold">{c.name ?? c.playerId}</span>
              {c.position && (
                <span className="font-mono text-[0.62rem] text-slate-600">{c.position}</span>
              )}
            </span>
            <span className="shrink-0 font-mono font-semibold tabular-nums">${c.bid}</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2 pl-5 text-[0.7rem] text-slate-500">
            <Who id={c.managerId} members={members} />
            <span className="font-mono tabular-nums">wk {c.week}</span>
            <span>
              ·{' '}
              {c.pointsStarted === null
                ? 'points unknown'
                : `${c.pointsStarted.toFixed(1)} started pts in ${c.weeksHeld} wk`}
              {showShort &&
                c.shortfall !== null &&
                `, ${Math.round(c.shortfall)} short of the position's rate`}
            </span>
            {c.droppedName && <span>· dropped {c.droppedName}</span>}
          </div>
          {/* The NFL stats he put up for this manager since the pickup: the same weeks as the
              points above. Nothing at all when none of them was a played week. */}
          {c.statLine && (
            <div className="pl-5 font-mono text-[0.7rem] tabular-nums text-slate-400">
              since pickup: {c.statLine}
            </div>
          )}
        </li>
      ))}
    </ol>
  )
}

export function FaabClaimLists({ faab, members }: { faab: FaabSeason; members: HistoryMember[] }) {
  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section className="min-w-0">
        <Heading>Most expensive claims</Heading>
        {faab.expensive.length === 0 ? (
          <p className="text-sm text-slate-500">No claims on record.</p>
        ) : (
          <ClaimRows claims={faab.expensive} members={members} />
        )}
      </section>
      <section className="min-w-0">
        <Heading anchor="faab-claim-shortfall" label="worst claims">
          Worst claims
        </Heading>
        {faab.worst.length === 0 ? (
          <p className="text-sm text-slate-500">No paid claims with known points yet.</p>
        ) : (
          <ClaimRows claims={faab.worst} members={members} showShort />
        )}
      </section>
    </div>
  )
}

export function LostBids({
  bids,
  members,
  limit = 15,
}: {
  bids: LostBid[]
  members: HistoryMember[]
  limit?: number
}) {
  const shown = bids.filter((b) => b.bid > 0).slice(0, limit)
  return (
    <section className="min-w-0">
      <Heading>Biggest lost bids</Heading>
      {shown.length === 0 ? (
        <p className="text-sm text-slate-500">No lost bids above $0.</p>
      ) : (
        <ul className="space-y-1.5">
          {shown.map((b, i) => (
            <li key={`${b.managerId}-${b.week}-${b.playerId}-${i}`} className="text-sm">
              <div className="leaders">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="font-semibold">{b.name ?? b.playerId}</span>
                  {b.position && (
                    <span className="font-mono text-[0.62rem] text-slate-600">{b.position}</span>
                  )}
                </span>
                <span className="shrink-0 font-mono font-semibold tabular-nums">${b.bid}</span>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-2 text-[0.7rem] text-slate-500">
                <Who id={b.managerId} members={members} />
                <span className="font-mono tabular-nums">wk {b.week}</span>
                {b.winnerManagerId !== null ? (
                  <span className="inline-flex items-baseline gap-1">
                    · lost to <Who id={b.winnerManagerId} members={members} /> at ${b.winnerBid}
                  </span>
                ) : (
                  b.note && <span>· {b.note}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-500">
        {bids.length} lost bids in all, {bids.filter((b) => b.bid === 0).length} of them at $0.
      </p>
    </section>
  )
}
