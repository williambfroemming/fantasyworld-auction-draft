import { describe, expect, it } from 'vitest'
import { formatShare, formatValue } from './format'

describe('formatValue', () => {
  it('defaults to a whole number with thousands separators', () => {
    expect(formatValue(undefined, 1234.6)).toBe('1,235')
    expect(formatValue({}, 0)).toBe('0')
  })

  it('applies prefix, suffix and decimals', () => {
    expect(formatValue({ prefix: '$' }, 3420)).toBe('$3,420')
    expect(formatValue({ decimals: 2 }, 1497.9999999999998)).toBe('1,498.00')
    expect(formatValue({ suffix: ' pts', decimals: 1 }, 112.34)).toBe('112.3 pts')
    expect(formatValue({ suffix: '%' }, 66.67)).toBe('67%')
  })

  it('puts the minus sign before the prefix', () => {
    expect(formatValue({ prefix: '$' }, -45)).toBe('-$45')
  })

  it('can switch thousands separators off, for years and ranks', () => {
    expect(formatValue({ thousands: false }, 2024)).toBe('2024')
  })

  it('prints a year in short form', () => {
    expect(formatValue({ shortYear: true }, 2024)).toBe('’24')
    expect(formatValue({ shortYear: true }, 2011)).toBe('’11')
  })

  it('survives being sent through JSON, which is what a server page does', () => {
    const spec = JSON.parse(JSON.stringify({ prefix: '$', decimals: 1 }))
    expect(formatValue(spec, 5)).toBe('$5.0')
  })
})

describe('formatValue signed', () => {
  it('shows a plus or a real minus, and no sign on zero', () => {
    expect(formatValue({ signed: true }, 1200)).toBe('+1,200')
    expect(formatValue({ signed: true }, -45.4)).toBe('\u221245')
    expect(formatValue({ signed: true }, 0)).toBe('0')
    expect(formatValue({ signed: true }, -0.2)).toBe('0') // rounds to zero: no "-0"
  })

  it('puts the sign before the prefix and keeps decimals', () => {
    expect(formatValue({ signed: true, prefix: '$', decimals: 1 }, -3.25)).toBe('\u2212$3.3')
  })
})

describe('formatShare', () => {
  it('rounds to a whole percent', () => {
    expect(formatShare(0.4949)).toBe('49%')
    expect(formatShare(1)).toBe('100%')
    expect(formatShare(0)).toBe('0%')
  })

  it('says <1% for a real but tiny share, never 0%', () => {
    expect(formatShare(0.002)).toBe('<1%')
    expect(formatShare(0.0049)).toBe('<1%')
    expect(formatShare(0.005)).toBe('1%')
  })
})
