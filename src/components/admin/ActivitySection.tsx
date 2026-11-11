'use client'

import { useEffect, useState } from 'react'
import { BarChart } from '@/components/charts/BarChart'
import { formatDuration, type ActivitySummary } from '@/lib/activity'
import { Btn, Section } from './ui'

/**
 * Who uses which pages, and for how long. Commissioner-only.
 *
 * Fetches `/api/admin/activity` on its own, on load and when a toggle changes.
 * It does not ride `useDraft`: activity is not league-wide state and must never
 * reach `/api/state`.
 *
 * "Active time" is visible AND recently touched (see the glossary), so the
 * numbers are smaller than wall-clock time on purpose.
 */
type Range = '7' | '30' | 'all'

interface ActivityData extends ActivitySummary {
  me: number
  members: Array<{ id: number; name: string; color: string }>
}

const RANGE_LABELS: Array<[Range, string]> = [
  ['7', '7 days'],
  ['30', '30 days'],
  ['all', 'All time'],
]

/** Columns in the heat table. The rest are still in the top-pages table. */
const HEAT_COLUMNS = 8
/** The daily chart shows at most this many of the most recent days. */
const CHART_DAYS = 31

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
  })

const shortDay = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })

export function ActivitySection() {
  const [range, setRange] = useState<Range>('7')
  const [includeMine, setIncludeMine] = useState(false)
  const [data, setData] = useState<ActivityData | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    fetch(`/api/admin/activity?days=${range}&mine=${includeMine ? 1 : 0}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        if (!live) return
        if (d.ok) {
          setData(d)
          setFailed(false)
        } else setFailed(true)
      })
      .catch(() => live && setFailed(true))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [range, includeMine])

  const pick = (r: Range) => {
    setLoading(true)
    setRange(r)
  }
  const toggleMine = () => {
    setLoading(true)
    setIncludeMine((v) => !v)
  }

  const name = new Map(data?.members.map((m) => [m.id, m]) ?? [])
  const heatPages = data?.byPage.slice(0, HEAT_COLUMNS) ?? []
  const cell = new Map(data?.matrix.map((c) => [`${c.managerId}|${c.key}`, c.seconds]) ?? [])
  const heatMax = Math.max(1, ...(data?.matrix.filter((c) => heatPages.some((p) => p.key === c.key)).map((c) => c.seconds) ?? []))
  const chartDays = data?.byDay.slice(-CHART_DAYS) ?? []

  return (
    <Section
      id="activity"
      title="Activity"
      note={
        <>
          Active time per page: the tab was visible and somebody had touched it in the last five minutes. Signed-in
          members only, kept on this site, seen by nobody but the commissioner.{' '}
          <a href="/glossary#active-time" className="underline">
            How it is counted
          </a>
          .
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {RANGE_LABELS.map(([r, label]) => (
          <Btn key={r} size="sm" tone={range === r ? 'primary' : 'ghost'} onClick={() => pick(r)} disabled={loading}>
            {label}
          </Btn>
        ))}
        <label className="ml-auto flex items-center gap-2 text-xs text-slate-400">
          <input type="checkbox" checked={!includeMine} onChange={toggleMine} disabled={loading} />
          Hide my own visits
        </label>
      </div>

      {failed && !data ? (
        <p className="mt-3 text-sm text-slate-500">
          Could not load activity. If this is a fresh deploy, run <code>npm run db:migrate-activity</code>.
        </p>
      ) : data === null ? (
        <p className="mt-3 text-sm text-slate-500">Loading…</p>
      ) : data.visits === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          No visits recorded {range === 'all' ? 'yet' : `in the last ${range} days`}
          {includeMine ? '' : ' (your own are hidden)'}.
        </p>
      ) : (
        <div className={`mt-4 space-y-6 ${loading ? 'opacity-60' : ''}`}>
          <p className="text-sm text-slate-300">
            <span className="font-semibold">{formatDuration(data.totalSeconds)}</span> across{' '}
            {data.visits.toLocaleString()} visits by {data.byManager.length}{' '}
            {data.byManager.length === 1 ? 'member' : 'members'}.
          </p>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">By member</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Member</th>
                    <th className="py-1 pr-3 text-right font-medium">Time</th>
                    <th className="py-1 pr-3 text-right font-medium">Visits</th>
                    <th className="py-1 text-right font-medium">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byManager.map((m) => (
                    <tr key={m.managerId} className="border-t border-rule">
                      <td className="whitespace-nowrap py-1.5 pr-3">
                        <span
                          className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                          style={{ background: name.get(m.managerId)?.color }}
                        />
                        {name.get(m.managerId)?.name ?? `#${m.managerId}`}
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums">{formatDuration(m.seconds)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{m.visits}</td>
                      <td className="whitespace-nowrap py-1.5 text-right text-slate-400">{dateTime(m.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.members.length > data.byManager.length + (includeMine ? 0 : 1) && (
              <p className="mt-2 text-xs text-slate-500">
                Not seen in this window:{' '}
                {data.members
                  .filter((m) => !data.byManager.some((b) => b.managerId === m.id) && (includeMine || m.id !== data.me))
                  .map((m) => m.name)
                  .join(', ')}
                .
              </p>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Top pages</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-slate-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Page</th>
                    <th className="py-1 pr-3 text-right font-medium">Time</th>
                    <th className="py-1 pr-3 text-right font-medium">Visits</th>
                    <th className="py-1 text-right font-medium">People</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byPage.map((p) => (
                    <tr key={p.key} className="border-t border-rule">
                      <td className="max-w-[16rem] truncate py-1.5 pr-3">{p.label}</td>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums">{formatDuration(p.seconds)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{p.visits}</td>
                      <td className="py-1.5 text-right tabular-nums">{p.people}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
              Who reads what
            </h3>
            <div className="overflow-x-auto">
              <table className="text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 pr-2 text-left font-medium" />
                    {heatPages.map((p) => (
                      <th key={p.key} className="max-w-[5.5rem] truncate px-1 py-1 text-center font-medium" title={p.label}>
                        {p.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.byManager.map((m) => (
                    <tr key={m.managerId}>
                      <th className="whitespace-nowrap py-0.5 pr-2 text-left font-medium text-slate-300">
                        {name.get(m.managerId)?.name ?? `#${m.managerId}`}
                      </th>
                      {heatPages.map((p) => {
                        const s = cell.get(`${m.managerId}|${p.key}`) ?? 0
                        const pct = Math.round((s / heatMax) * 85)
                        return (
                          <td
                            key={p.key}
                            className="whitespace-nowrap px-1 py-0.5 text-center tabular-nums"
                            style={
                              s
                                ? { background: `color-mix(in srgb, var(--color-emerald-500) ${pct}%, transparent)` }
                                : undefined
                            }
                          >
                            {s ? formatDuration(s) : <span className="text-slate-600">·</span>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
              Minutes per day{data.byDay.length > CHART_DAYS ? ` (last ${CHART_DAYS} days)` : ''}
            </h3>
            <BarChart
              ariaLabel="Active minutes per day"
              format={{ suffix: 'm' }}
              rows={chartDays.map((d) => ({ id: d.day, label: shortDay(d.day), value: Math.round(d.seconds / 60) }))}
            />
          </div>
        </div>
      )}
    </Section>
  )
}
