import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import nextConfig from '../../next.config'
import { OFF_BAR, SECTIONS, isMenu, sectionItems } from '@/components/SiteNav'
import { SIGNED_OUT, SWITCHED_OFF, refusalMessage } from '@/components/OracleBar'
import { isPublicPath } from './gate'

/** docs/archive/SITE_STRUCTURE.md — the properties a comment cannot enforce. */

const read = (p: string) => readFileSync(resolve(import.meta.dirname, '..', p), 'utf8')

describe('the top bar', () => {
  it('is The Gazette, History and Auction, in that order', () => {
    expect(SECTIONS.map((s) => s.label)).toEqual(['The Gazette', 'History', 'Auction'])
  })

  it('makes the Gazette a direct link, not a menu', () => {
    const g = SECTIONS[0]
    expect(isMenu(g)).toBe(false)
    expect(sectionItems(g).map((i) => i.href)).toEqual(['/gazette'])
  })

  it("puts each menu's home page first", () => {
    const first = SECTIONS.filter(isMenu).map((s) => s.groups[0].items[0].href)
    expect(first).toEqual(['/history', '/draft'])
  })

  it('keeps History to past seasons: nine items, no Gazette, Oracle or Glossary', () => {
    const history = SECTIONS.find((s) => s.key === 'history')!
    const hrefs = sectionItems(history).map((i) => i.href)
    expect(hrefs).toHaveLength(9)
    for (const gone of ['/gazette', '/oracle', '/glossary', '/history/drafts']) {
      expect(hrefs).not.toContain(gone)
    }
  })

  it('splits Auction into this year and past auctions', () => {
    const auction = SECTIONS.find((s) => s.key === 'auction')!
    if (!isMenu(auction)) throw new Error('Auction must be a menu')
    expect(auction.groups.map((g) => [g.label, g.items.map((i) => i.href)])).toEqual([
      ['This year', ['/draft', '/board', '/trades']],
      ['Past auctions', ['/history/drafts', '/stats']],
    ])
  })

  it('lists no page twice, the bar and the off-bar pages together', () => {
    const all = [...SECTIONS.flatMap(sectionItems), ...OFF_BAR].map((i) => i.href)
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('route moves', () => {
  it('redirects the old Gazette and Oracle paths permanently', async () => {
    const rules = await nextConfig.redirects!()
    expect(rules).toEqual([
      { source: '/history/gazette', destination: '/gazette', permanent: true },
      { source: '/history/gazette/:season/:week', destination: '/gazette/:season/:week', permanent: true },
      { source: '/history/oracle', destination: '/oracle', permanent: true },
    ])
  })

  it('leaves the new routes behind the PIN', () => {
    for (const p of ['/gazette', '/gazette/2025/7', '/oracle']) expect(isPublicPath(p), p).toBe(false)
  })

  it('does not turn on cacheComponents, which would delete `dynamic` from /api/state', () => {
    expect((nextConfig as Record<string, unknown>).cacheComponents).toBeUndefined()
  })

  it('builds the new-issue email link on the new path', () => {
    const src = readFileSync(resolve(import.meta.dirname, '../../scripts/history/notify-email.ts'), 'utf8')
    expect(src).toContain('${SITE}/gazette/${issue.season}/${issue.week}')
    expect(src).not.toContain('/history/gazette')
  })
})

describe('the Oracle launcher', () => {
  it('is hidden on every draft page and on /oracle itself', () => {
    for (const page of ['app/draft/page.tsx', 'app/board/page.tsx', 'app/trades/page.tsx', 'app/oracle/page.tsx']) {
      const src = read(page)
      expect(src, page).toContain('<HeaderControls hideOracle />')
      expect(src, page).not.toMatch(/<HeaderControls\s*\/>/)
    }
  })

  it('mounts OracleBar only while the panel is open, and fetches nothing itself', () => {
    const src = read('components/OracleLauncher.tsx')
    expect(src).toMatch(/\{open && \(/)
    // OracleBar appears once, after the `open &&` guard.
    expect(src.indexOf('<OracleBar')).toBeGreaterThan(src.indexOf('{open && ('))
    expect(src).not.toMatch(/\bfetch\(/)
    expect(src).not.toMatch(/useEffect/)
  })

  it('never reaches the polling path or the fingerprint', () => {
    for (const f of ['components/OracleLauncher.tsx', 'components/OracleBar.tsx']) {
      const src = read(f)
      expect(src, f).not.toMatch(/fetch\(\s*['"`]\/api\/state/)
      expect(src, f).not.toMatch(/from\s+['"][^'"]*\/version['"]/)
      // The only endpoint either one calls.
      expect([...src.matchAll(/fetch\(\s*['"`]([^'"`]+)/g)].map((m) => m[1]), f).toEqual(
        f.endsWith('OracleBar.tsx') ? ['/api/ask'] : [],
      )
    }
  })

  it('says plainly when the member is signed out or the Oracle is off', () => {
    expect(refusalMessage(401, 'Not signed in')).toBe(SIGNED_OUT)
    expect(refusalMessage(503, undefined)).toBe(SWITCHED_OFF)
    expect(refusalMessage(503, 'The Oracle is switched off right now. Ask the commissioner.')).toBe(
      'The Oracle is switched off right now. Ask the commissioner.',
    )
    expect(refusalMessage(429, 'too many')).toBeNull()
  })
})

describe('the account menu', () => {
  it('carries the Glossary, its only entry in the nav', () => {
    expect(read('components/AccountMenu.tsx')).toContain('href="/glossary"')
    expect(read('components/SiteNav.tsx').match(/'\/glossary'/g)).toHaveLength(1) // OFF_BAR only
  })
})
