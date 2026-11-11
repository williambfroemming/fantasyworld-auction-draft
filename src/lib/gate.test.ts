import { describe, expect, it } from 'vitest'
import { isPublicPath, safeNext } from './gate'

describe('isPublicPath', () => {
  it('allows only the sign-in page and the endpoints it needs', () => {
    expect(isPublicPath('/join')).toBe(true)
    expect(isPublicPath('/api/session')).toBe(true)
    expect(isPublicPath('/api/seats')).toBe(true)
  })

  it('gates everything else, including the pages and APIs that used to be open', () => {
    for (const p of [
      '/',
      '/history',
      '/history/gazette',
      '/history/oracle',
      '/glossary',
      '/stats',
      '/board',
      '/draft',
      '/setup',
      '/api/state',
      '/api/ask',
      '/api/queue',
      '/api/export',
    ]) {
      expect(isPublicPath(p), p).toBe(false)
    }
  })

  it('does not treat a lookalike or a sub-path as public', () => {
    expect(isPublicPath('/join/x')).toBe(false)
    expect(isPublicPath('/api/session/x')).toBe(false)
    expect(isPublicPath('/api/seats2')).toBe(false)
    expect(isPublicPath('/JOIN')).toBe(false)
  })
})

describe('safeNext', () => {
  it('keeps a same-site path, query and all', () => {
    expect(safeNext('/history/gazette/2025/7')).toBe('/history/gazette/2025/7')
    expect(safeNext('/stats?season=2024')).toBe('/stats?season=2024')
  })

  it('falls back to the front page when there is nothing to honour', () => {
    expect(safeNext(null)).toBe('/')
    expect(safeNext(undefined)).toBe('/')
    expect(safeNext('')).toBe('/')
  })

  it('refuses anything that could leave the site', () => {
    for (const bad of [
      '//evil.example',
      '/\\evil.example',
      'https://evil.example',
      'javascript:alert(1)',
      'history',
      '/ok\nSet-Cookie: x=1',
    ]) {
      expect(safeNext(bad), bad).toBe('/')
    }
  })

  it('refuses the sign-in page itself, which would loop', () => {
    expect(safeNext('/join')).toBe('/')
    expect(safeNext('/join?next=/x')).toBe('/')
  })

  it('refuses an absurdly long value', () => {
    expect(safeNext('/' + 'a'.repeat(600))).toBe('/')
  })
})
