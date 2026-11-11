import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  IDLE_MS,
  MAX_SECONDS,
  activitySummary,
  createActivityClock,
  formatDuration,
  isUntrackedPath,
  normalisePath,
  pageGroup,
  type VisitRow,
} from './activity'

const S = 1000
const T0 = Date.UTC(2026, 10, 1, 20, 0, 0) // 1 Nov 2026, 1pm Pacific

describe('normalisePath', () => {
  it('strips the query string, hash and trailing slash', () => {
    expect(normalisePath('/join?next=%2Fdraft')).toBe('/join')
    expect(normalisePath('/history/records/#top')).toBe('/history/records')
    expect(normalisePath('/')).toBe('/')
    expect(normalisePath('/history///')).toBe('/history')
  })
  it('refuses anything that is not a same-site path', () => {
    for (const bad of ['', 'draft', '//evil.example', 'https://x.y/', '/a b', '/a\\b', null, 7]) {
      expect(normalisePath(bad), String(bad)).toBeNull()
    }
  })
  it('caps the length', () => {
    expect(normalisePath('/' + 'a'.repeat(500))).toHaveLength(200)
  })
})

describe('pageGroup', () => {
  it('a query string never changes the group', () => {
    expect(pageGroup(normalisePath('/history/records?season=2024')!)).toEqual(pageGroup('/history/records'))
  })
  it('dynamic ids collapse to one group', () => {
    expect(pageGroup('/history/members/3').key).toBe('member')
    expect(pageGroup('/history/members/9').key).toBe('member')
    expect(pageGroup('/history/members').key).toBe('members')
    expect(pageGroup('/history/gazette/2025/7').label).toBe('Gazette issue')
    expect(pageGroup('/history/gazette').label).toBe('The Gazette')
    expect(pageGroup('/history/players/4046').key).toBe('player')
  })
  it('unknown paths survive as their own Other row', () => {
    const g = pageGroup('/somewhere/new')
    expect(g.key).toBe('other:/somewhere/new')
    expect(g.label).toContain('/somewhere/new')
  })

  it('every real page in src/app has a named group (except the sign-in page)', () => {
    // Walk the actual route tree, so a new page that nobody added to the table
    // shows up here rather than quietly as "Other".
    const root = join(__dirname, '..', 'app')
    const pages: string[] = []
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f)
        if (statSync(p).isDirectory()) walk(p)
        else if (f === 'page.tsx') pages.push(relative(root, dir))
      }
    }
    walk(root)
    expect(pages.length).toBeGreaterThan(10)
    for (const rel of pages) {
      const path = '/' + rel.split(/[\\/]/).filter(Boolean).map((s) => (s.startsWith('[') ? '1' : s)).join('/')
      if (isUntrackedPath(path)) continue
      expect(pageGroup(path === '//' ? '/' : path).key, path).not.toMatch(/^other:/)
    }
  })
})

describe('createActivityClock', () => {
  it('counts visible, active time', () => {
    const c = createActivityClock(T0, true)
    c.input(T0 + 30 * S)
    expect(c.flush(T0 + 60 * S)).toEqual({ startedAt: T0, activeSeconds: 60 })
  })

  it('idle past IDLE_MS stops the clock, and only the active stretch counts', () => {
    const c = createActivityClock(T0, true)
    expect(c.tick(T0 + 60 * S)).toBeNull()
    // Nobody touches anything for an hour. The tick arrives late; the idle
    // stretch must not be credited.
    const seg = c.tick(T0 + 3600 * S)
    expect(seg).toEqual({ startedAt: T0, activeSeconds: IDLE_MS / 1000 })
    expect(c.tick(T0 + 7200 * S)).toBeNull()
    expect(c.flush(T0 + 7300 * S)).toBeNull()
  })

  it('a board left on a TV all night adds nothing past the first five minutes', () => {
    const c = createActivityClock(T0, true)
    let total = 0
    for (let t = T0; t < T0 + 9 * 3600 * S; t += 30 * S) total += c.tick(t)?.activeSeconds ?? 0
    total += c.flush(T0 + 9 * 3600 * S)?.activeSeconds ?? 0
    expect(total).toBe(IDLE_MS / 1000)
  })

  it('input after idling starts a new segment', () => {
    const c = createActivityClock(T0, true)
    c.tick(T0 + 3600 * S)
    c.input(T0 + 4000 * S)
    expect(c.flush(T0 + 4010 * S)).toEqual({ startedAt: T0 + 4000 * S, activeSeconds: 10 })
  })

  it('hidden time never counts', () => {
    const c = createActivityClock(T0, true)
    c.hidden(T0 + 10 * S)
    c.input(T0 + 100 * S) // input while hidden is impossible in a browser; harmless here
    c.visible(T0 + 600 * S)
    expect(c.flush(T0 + 620 * S)?.activeSeconds).toBe(30)
  })

  it('a clock created hidden counts nothing until it is shown', () => {
    const c = createActivityClock(T0, false)
    c.input(T0 + 5 * S)
    expect(c.flush(T0 + 50 * S)).toBeNull()
    c.visible(T0 + 60 * S)
    expect(c.flush(T0 + 70 * S)).toEqual({ startedAt: T0 + 60 * S, activeSeconds: 10 })
  })

  it('flush under MIN_SECONDS returns nothing', () => {
    const c = createActivityClock(T0, true)
    expect(c.flush(T0 + 1 * S)).toBeNull()
  })

  it('flushing starts the next segment from the flush, not from the beginning', () => {
    const c = createActivityClock(T0, true)
    c.flush(T0 + 20 * S)
    c.input(T0 + 25 * S)
    expect(c.flush(T0 + 40 * S)).toEqual({ startedAt: T0 + 20 * S, activeSeconds: 20 })
  })

  it('a long active stretch is cut at MAX_SECONDS, nothing lost', () => {
    const c = createActivityClock(T0, true)
    let total = 0
    let segs = 0
    for (let t = T0 + 30 * S; t <= T0 + 3600 * S; t += 30 * S) {
      c.input(t)
      const s = c.tick(t)
      if (s) {
        expect(s.activeSeconds).toBeLessThanOrEqual(MAX_SECONDS)
        total += s.activeSeconds
        segs++
      }
    }
    total += c.flush(T0 + 3600 * S)?.activeSeconds ?? 0
    expect(segs).toBe(2)
    expect(total).toBe(3600)
  })
})

describe('activitySummary', () => {
  const at = (h: number) => new Date(T0 + h * 3600 * S).toISOString()
  const rows: VisitRow[] = [
    { managerId: 1, path: '/draft', startedAt: at(0), activeSeconds: 600 },
    { managerId: 1, path: '/history/members/3', startedAt: at(1), activeSeconds: 120 },
    { managerId: 2, path: '/history/members/7', startedAt: at(2), activeSeconds: 60 },
    { managerId: 2, path: '/draft', startedAt: at(50), activeSeconds: 30 },
    { managerId: 3, path: '/brand-new', startedAt: at(3), activeSeconds: 5 },
  ]

  it('totals per manager, per page and per cell', () => {
    const s = activitySummary(rows)
    expect(s.totalSeconds).toBe(815)
    expect(s.visits).toBe(5)
    expect(s.byManager.map((m) => [m.managerId, m.seconds, m.visits])).toEqual([
      [1, 720, 2],
      [2, 90, 2],
      [3, 5, 1],
    ])
    expect(s.byManager[1].lastSeen).toBe(at(50))
    const member = s.byPage.find((p) => p.key === 'member')!
    expect(member).toMatchObject({ label: 'Member page', seconds: 180, visits: 2, people: 2 })
    expect(s.byPage.find((p) => p.key === 'other:/brand-new')?.seconds).toBe(5)
    expect(s.matrix).toContainEqual({ managerId: 1, key: 'draft', seconds: 600 })
    expect(s.matrix.reduce((a, c) => a + c.seconds, 0)).toBe(815)
  })

  it('respects excludeIds', () => {
    const s = activitySummary(rows, { excludeIds: [1] })
    expect(s.totalSeconds).toBe(95)
    expect(s.byManager.some((m) => m.managerId === 1)).toBe(false)
  })

  it('respects the window, from inclusive and to exclusive', () => {
    const s = activitySummary(rows, { from: new Date(at(1)), to: new Date(at(3)) })
    expect(s.visits).toBe(2)
    expect(s.totalSeconds).toBe(180)
  })

  it('days run in the league time zone, with empty days filled', () => {
    // 1 Nov 1pm Pacific → 3 Nov 3pm Pacific (at(50)). Three days, one of them empty.
    const s = activitySummary(rows)
    expect(s.byDay.map((d) => d.day)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03'])
    expect(s.byDay[1].seconds).toBe(0)
    expect(s.byDay.reduce((a, d) => a + d.seconds, 0)).toBe(815)
    // 8pm Pacific on the 1st is the 2nd in UTC; it still belongs to the 1st.
    const late = activitySummary([{ managerId: 1, path: '/', startedAt: at(7), activeSeconds: 10 }])
    expect(late.byDay).toEqual([{ day: '2026-11-01', seconds: 10 }])
  })

  it('is empty, not zero-filled, with no rows', () => {
    expect(activitySummary([])).toMatchObject({ totalSeconds: 0, visits: 0, byManager: [], byDay: [] })
  })
})

describe('formatDuration', () => {
  it('reads like a person would say it', () => {
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(200)).toBe('3m 20s')
    expect(formatDuration(600)).toBe('10m')
    expect(formatDuration(2 * 3600 + 14 * 60 + 9)).toBe('2h 14m')
  })
})
