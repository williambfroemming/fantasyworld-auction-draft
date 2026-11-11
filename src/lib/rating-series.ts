import type { LineSeries } from '@/components/charts/LineChart'
import { weekAxis, type ManagerRating } from '@/lib/rating'

/**
 * Rating history as chart series on one shared axis of game weeks, plus the boundaries,
 * labels and y range. `color` and `name` resolve a manager id to what to draw.
 */
export function ratingChart(
  history: ManagerRating[],
  who: (managerId: number) => { name: string; color: string },
  /** Fix the axis to every manager's weeks even when drawing a subset. */
  axisFrom: ManagerRating[] = history,
) {
  const axis = weekAxis(axisFrom)
  const series: LineSeries[] = history.map((m) => {
    const w = who(m.managerId)
    return {
      id: String(m.managerId),
      label: w.name,
      color: w.color,
      points: m.points.map((p) => ({ x: axis.index.get(`${p.season}:${p.week}`)!, y: p.rating })),
    }
  })
  const all = series.flatMap((s) => s.points.map((p) => p.y as number))
  const lo = Math.floor((Math.min(...all, 1500) - 10) / 25) * 25
  const hi = Math.ceil((Math.max(...all, 1500) + 10) / 25) * 25
  return {
    series,
    labels: axis.labels,
    marks: axis.seasonStarts.map((s) => ({ x: s.x, label: `’${String(s.season).slice(-2)}` })),
    yDomain: [lo, hi] as [number, number],
  }
}
