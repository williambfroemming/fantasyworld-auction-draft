import Link from 'next/link'
import { EraBadge } from '@/components/history/EraBadge'
import { GlossaryLink } from '@/components/GlossaryLink'
import { SiteNav } from '@/components/SiteNav'
import { ThemeToggle } from '@/components/ThemeToggle'
import { managerColor } from '@/lib/colors'
import { getHeadToHead } from '@/server/history-service'

/**
 * Everyone against everyone.
 *
 * Regular season only — a head-to-head table is read as "who owns whom over a
 * long run", and playoff meetings are rare and unevenly distributed enough that
 * including them says more about seeding than about the matchup.
 *
 * ## Reading the colour
 *
 * One diverging scale, not ten. The first cut tinted each cell by the row
 * manager's own colour and computed the text colour from that tint — which put
 * pale text on pale backgrounds in the light theme and made half the grid
 * unreadable. Ten hues also compete with each other, so nothing stands out.
 *
 * Now: green above .500, red below, intensity tracking distance from even, and
 * the **text colour is left alone** so contrast is whatever the theme already
 * guarantees. Colour is never the only encoding — every cell prints its record.
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
          {/* "Read across: each row is that manager's record against the
              manager in the column" is now a glossary entry. The scope is not
              — a grid that silently drops playoff meetings has to say so. */}
          <p className="flex items-baseline gap-2 text-xs text-slate-400">
            Regular season only.
            <GlossaryLink anchor="h2h-scope" label="head to head" />
          </p>
          <p className="flex items-center gap-2 text-[0.68rem] text-slate-500">
            <span
              className="inline-block h-3 w-6"
              style={{ backgroundColor: 'color-mix(in oklab, var(--color-rose-500) 26%, transparent)' }}
            />
            losing
            <span
              className="inline-block h-3 w-6"
              style={{ backgroundColor: 'color-mix(in oklab, var(--color-emerald-500) 26%, transparent)' }}
            />
            winning
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
                  <tr key={row.managerId} className="border-t border-rule even:bg-slate-500/[0.04]">
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
                      const pct = games ? cell.wins / games : 0.5
                      // 0 at even, 1 at a clean sweep. Squared-off so a 6-5 is
                      // barely tinted and an 8-2 is obvious.
                      const away = Math.min(Math.abs(pct - 0.5) * 2, 1)
                      const alpha = Math.round(away * 26)
                      const hue = pct >= 0.5 ? 'emerald' : 'rose'
                      return (
                        <td
                          key={col.managerId}
                          className="px-2 py-1.5 text-center font-mono text-xs font-medium tabular-nums"
                          style={
                            alpha >= 3
                              ? {
                                  backgroundColor: `color-mix(in oklab, var(--color-${hue}-500) ${alpha}%, transparent)`,
                                }
                              : undefined
                          }
                          title={`${row.displayName} vs ${col.displayName}: ${cell.wins}-${cell.losses}${cell.ties ? `-${cell.ties}` : ''} · ${cell.pointsFor.toFixed(0)} points for, ${cell.pointsAgainst.toFixed(0)} against`}
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
