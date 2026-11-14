import { describe, expect, it } from 'vitest'
import {
  assignLabels,
  escapeHtml,
  renderBakeoffPage,
  type BakeoffEdition,
  type BakeoffWeek,
} from './gazette-bakeoff'

const ed = (who: string, over: Partial<BakeoffEdition> = {}): BakeoffEdition => ({
  issueTitle: `${who} title`,
  headline: `${who} headline`,
  deck: `${who} deck`,
  column: `${who} paragraph one.\n\n${who} paragraph two.`,
  gameNotes: [`${who} note`],
  ...over,
})

const week = (w: number): BakeoffWeek => ({
  season: 2025,
  week: w,
  weekLabel: `Week ${w}`,
  editions: { 'single-pass': ed(`SINGLE${w}`), pipeline: ed(`ROOM${w}`) },
})

/** A deterministic stand-in for Math.random, for tests only. */
const seq = (...xs: number[]) => {
  let i = 0
  return () => xs[i++ % xs.length]
}

describe('assignLabels', () => {
  it('puts each arm under exactly one letter, per week', () => {
    for (const k of assignLabels([week(6), week(7), week(8)])) {
      expect([k.X, k.Y].sort()).toEqual(['pipeline', 'single-pass'])
    }
  })

  it('follows the random draw: below a half puts the pipeline under X', () => {
    const key = assignLabels([week(6), week(7)], seq(0.1, 0.9))
    expect(key.map((k) => k.X)).toEqual(['pipeline', 'single-pass'])
  })
})

describe('renderBakeoffPage', () => {
  const weeks = [week(6), week(7)]
  const key = assignLabels(weeks, seq(0.1, 0.9))
  const html = renderBakeoffPage(weeks, key)

  it('places each edition under the letter the key says', () => {
    const s6 = html.slice(html.indexOf('Week 6 ·'), html.indexOf('Week 7 ·'))
    expect(s6.indexOf('Edition X')).toBeLessThan(s6.indexOf('ROOM6 headline'))
    expect(s6.indexOf('ROOM6 headline')).toBeLessThan(s6.indexOf('Edition Y'))
    expect(s6.indexOf('Edition Y')).toBeLessThan(s6.indexOf('SINGLE6 headline'))

    const s7 = html.slice(html.indexOf('Week 7 ·'))
    expect(s7.indexOf('SINGLE7 headline')).toBeLessThan(s7.indexOf('ROOM7 headline'))
  })

  it('never names an arm', () => {
    expect(html.toLowerCase()).not.toMatch(/pipeline|single-pass|single pass|prompt|editorial room|judge/)
  })

  it('is self-contained: no script, no external request', () => {
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/(src|href)=["']?https?:/i)
    expect(html).not.toMatch(/@import|url\(/i)
  })

  it('escapes prose, so a stray tag in a column arrives as text', () => {
    const w = week(9)
    w.editions.pipeline = ed('ROOM9', { column: 'He scored <b>130</b> & lost.' })
    const page = renderBakeoffPage([w], assignLabels([w]))
    expect(page).toContain('He scored &lt;b&gt;130&lt;/b&gt; &amp; lost.')
    expect(page).not.toContain('<b>130</b>')
  })

  it('splits a column into paragraphs on blank lines', () => {
    expect(html).toContain('<p>ROOM6 paragraph one.</p>\n<p>ROOM6 paragraph two.</p>')
  })

  it('refuses a week the key does not cover', () => {
    expect(() => renderBakeoffPage([week(6), week(7)], key.slice(0, 1))).toThrow('week 7')
  })
})

describe('escapeHtml', () => {
  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  })
})
