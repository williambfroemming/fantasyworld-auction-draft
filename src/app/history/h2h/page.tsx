import Link from 'next/link'
import { EraBadge } from '@/components/history/EraBadge'
import { SiteNav } from '@/components/SiteNav'
import { ThemeToggle } from '@/components/ThemeToggle'
import { managerColor, managerTint, textOn } from '@/lib/colors'
import { getHeadToHead } from '@/server/history-service'

/**
 * Everyone against everyone.
 *
 * Regular season only — a head-to-head table is read as "who owns whom over a
 * long run", and playoff meetings are rare and unevenly distributed enough that
 * including them says more about seeding than about the matchup.
 *
 * ⚠️ Colour is never the only encoding. Each cell prints its record in text and
 * is tinted by win rate on top; the tint is an accelerant for scanning, not the
 * information.
 */
export const revalidate = 3600

export const metadata = { title: 'Head to head — FantasyWorld' }

export default async function HeadToHeadPage() {
  const { report, members } = await getHeadToHead()
  const ordered = [...members].sort((a, b) => a.displayName.localeCompare(b.displayName))

  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav section="league-history" current="/history/h2h" />
        <h1 className="font-display text-lg font-bold uppercase tracking-[0.08em]">Head to Head</h1>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <div className="mx-auto max-w-[86rem] px-4 py-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-rule-strong pb-2">
          <p className="text-xs text-slate-400">
            Read across: each row is that manager&rsquo;s record <em>against</em> the manager in the
            column. Regular season only.
          </p>
          <EraBadge coverage={report.coverage} />
        </div>

        <div className="overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-slate-950 px-2 py-2 text-left font-display text-[0.62rem] uppercase tracking-[0.08em] text-slate-400">
                  vs →
                </th>
                {ordered.map((m) => (
                  <th
                    key={m.managerId}
                    className="px-2 py-2 text-center font-display text-[0.62rem] uppercase tracking-[0.06em] text-slate-400"
                  >
                    {m.displayName}
                  </th>
                ))}
                <th className="px-2 py-2 text-center font-display text-[0.62rem] uppercase tracking-[0.08em] text-slate-400">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((row) => {
                const mine = report.cells.filter((c) => c.managerId === row.managerId)
                const w = mine.reduce((s, c) => s + c.wins, 0)
                const l = mine.reduce((s, c) => s + c.losses, 0)
                const t = mine.reduce((s, c) => s + c.ties, 0)
                return (
                  <tr key={row.managerId} className="border-t border-rule">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 bg-slate-950 px-2 py-1.5 text-left font-semibold"
                    >
                      <Link
                        href={`/history/members/${row.managerId}`}
                        className="flex items-baseline gap-2 hover:text-amber-300"
                      >
                        <span
                          aria-hidden
                          className="h-3 w-1 shrink-0"
                          style={{ backgroundColor: managerColor(row.color) }}
                        />
                        {row.displayName}
                      </Link>
                    </th>

                    {ordered.map((col) => {
                      if (col.managerId === row.managerId) {
                        return (
                          <td key={col.managerId} className="bg-slate-900/60 px-2 py-1.5 text-center text-slate-700">
                            —
                          </td>
                        )
                      }
                      const cell = report.get(row.managerId, col.managerId)
                      if (!cell) {
                        return (
                          <td key={col.managerId} className="px-2 py-1.5 text-center text-slate-600">
                            ·
                          </td>
                        )
                      }
                      const games = cell.wins + cell.losses + cell.ties
                      const pct = games ? cell.wins / games : 0
                      const base = managerColor(row.color)
                      // Tint strength tracks win rate; the record is still printed.
                      const strength = Math.round(Math.abs(pct - 0.5) * 2 * 42)
                      const winning = pct > 0.5
                      return (
                        <td
                          key={col.managerId}
                          className="px-2 py-1.5 text-center font-mono text-xs tabular-nums"
                          style={
                            strength > 4
                              ? {
                                  backgroundColor: managerTint(base, winning ? strength : 0),
                                  color: winning ? textOn(managerTint(base, strength)) : undefined,
                                }
                              : undefined
                          }
                          title={`${row.displayName} vs ${col.displayName}: ${cell.wins}-${cell.losses}${cell.ties ? `-${cell.ties}` : ''} · ${cell.pointsFor.toFixed(0)} pts for, ${cell.pointsAgainst.toFixed(0)} against`}
                        >
                          {cell.wins}-{cell.losses}
                          {cell.ties ? `-${cell.ties}` : ''}
                        </td>
                      )
                    })}

                    <td className="border-l border-rule-strong px-2 py-1.5 text-center font-mono text-xs font-semibold tabular-nums">
                      {w}-{l}
                      {t ? `-${t}` : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
