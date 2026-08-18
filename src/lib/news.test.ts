import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  fromEspn,
  fromSleeperTrending,
  indexByPlayer,
  nameOnlyKey,
  newsFor,
  type EspnNewsResponse,
} from './news'

const NOW = 1_760_000_000_000

function espn(over: Partial<NonNullable<EspnNewsResponse['articles']>[number]> = {}) {
  return {
    headline: 'Something happened',
    description: 'A summary',
    published: '2026-08-17T12:00:00Z',
    links: { web: { href: 'https://espn.com/story' } },
    categories: [],
    ...over,
  }
}

const athlete = (name: string, id = 1) => ({
  type: 'athlete',
  athlete: { id, description: name },
})

describe('fromEspn', () => {
  it('emits one item per player tagged on a story', () => {
    const items = fromEspn(
      { articles: [espn({ categories: [athlete('Puka Nacua'), athlete('Cooper Kupp', 2)] })] },
      NOW,
    )
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.playerName)).toEqual(['Puka Nacua', 'Cooper Kupp'])
    expect(items[0].source).toBe('ESPN')
    expect(items[0].url).toBe('https://espn.com/story')
  })

  it('keeps a story tagged to nobody, with a null key', () => {
    const items = fromEspn({ articles: [espn({ categories: [{ type: 'league' }] })] }, NOW)
    expect(items).toHaveLength(1)
    expect(items[0].key).toBeNull()
    expect(items[0].playerName).toBeNull()
  })

  it('drops an article with no headline rather than rendering a blank row', () => {
    expect(fromEspn({ articles: [espn({ headline: '   ' })] }, NOW)).toHaveLength(0)
  })

  /**
   * An unparseable date must not sort to 1970 — that would bury a fresh story
   * at the bottom of every list, silently, and look like the feed was stale.
   */
  it('treats an unparseable date as now, not as the epoch', () => {
    const items = fromEspn(
      { articles: [espn({ published: 'not a date', categories: [athlete('X')] })] },
      NOW,
    )
    expect(items[0].published).toBe(NOW)
  })

  it('survives a payload with nothing in it', () => {
    expect(fromEspn({}, NOW)).toEqual([])
    expect(fromEspn({ articles: null }, NOW)).toEqual([])
  })
})

describe('nameOnlyKey', () => {
  it('folds the punctuation two sources disagree about', () => {
    expect(nameOnlyKey("Ja'Marr Chase")).toBe(nameOnlyKey('JaMarr Chase'))
    expect(nameOnlyKey('A.J. Brown')).toBe(nameOnlyKey('AJ Brown'))
    expect(nameOnlyKey('Marvin Harrison Jr.')).toBe(nameOnlyKey('Marvin Harrison'))
  })

  it('carries no trailing position separator', () => {
    expect(nameOnlyKey('Josh Allen')).toBe('joshallen')
  })
})

describe('newsFor', () => {
  const items = fromEspn(
    {
      articles: [
        espn({
          headline: 'Older story',
          published: '2026-08-01T00:00:00Z',
          categories: [athlete('Puka Nacua')],
        }),
        espn({
          headline: 'Newer story',
          published: '2026-08-16T00:00:00Z',
          categories: [athlete('Puka Nacua')],
        }),
        espn({ headline: 'Someone else', categories: [athlete('Cooper Kupp')] }),
      ],
    },
    NOW,
  )

  it('returns only that player, newest first', () => {
    const got = newsFor(items, 'Puka Nacua')
    expect(got.map((i) => i.headline)).toEqual(['Newer story', 'Older story'])
  })

  it('matches across a spelling difference between provider and pool', () => {
    const withSuffix = fromEspn(
      { articles: [espn({ categories: [athlete('Marvin Harrison Jr.')] })] },
      NOW,
    )
    expect(newsFor(withSuffix, 'Marvin Harrison')).toHaveLength(1)
  })

  it('returns nothing for a player nobody wrote about — the common case', () => {
    expect(newsFor(items, 'Some Backup Kicker')).toEqual([])
  })

  it('honours the limit', () => {
    const many = fromEspn(
      {
        articles: Array.from({ length: 10 }, (_, i) =>
          espn({ headline: `Story ${i}`, categories: [athlete('Puka Nacua')] }),
        ),
      },
      NOW,
    )
    expect(newsFor(many, 'Puka Nacua', 3)).toHaveLength(3)
  })
})

describe('indexByPlayer', () => {
  it('buckets by player and drops the untagged stories', () => {
    const items = fromEspn(
      {
        articles: [
          espn({ categories: [athlete('Puka Nacua'), athlete('Cooper Kupp', 2)] }),
          espn({ categories: [{ type: 'league' }] }),
        ],
      },
      NOW,
    )
    const idx = indexByPlayer(items)
    expect(idx.size).toBe(2)
    expect(idx.get(nameOnlyKey('Puka Nacua'))).toHaveLength(1)
  })

  it('sorts each bucket newest first', () => {
    const items = fromEspn(
      {
        articles: [
          espn({ headline: 'old', published: '2026-01-01T00:00:00Z', categories: [athlete('A')] }),
          espn({ headline: 'new', published: '2026-08-01T00:00:00Z', categories: [athlete('A')] }),
        ],
      },
      NOW,
    )
    expect(indexByPlayer(items).get(nameOnlyKey('A'))!.map((i) => i.headline)).toEqual([
      'new',
      'old',
    ])
  })
})

describe('fromSleeperTrending', () => {
  it('normalises the add/drop payload', () => {
    expect(
      fromSleeperTrending([{ player_id: '4046', count: 60390 }], 'add'),
    ).toEqual([{ sleeperId: '4046', direction: 'add', count: 60390 }])
  })

  it('skips malformed rows instead of emitting NaN counts', () => {
    expect(
      fromSleeperTrending(
        [{ player_id: '1', count: 5 }, { player_id: '2' }, { count: 9 }],
        'drop',
      ),
    ).toHaveLength(1)
  })

  it('survives a null payload — a dead provider is empty, not fatal', () => {
    expect(fromSleeperTrending(null, 'add')).toEqual([])
    expect(fromSleeperTrending(undefined, 'drop')).toEqual([])
  })
})

/**
 * §1's first rule, enforced structurally rather than by discipline.
 *
 * "News never touches /api/state. That route is polled by every client — adding
 * a third-party fetch to it puts someone else's uptime on the critical path of
 * every award."
 *
 * A comment saying so is not enforcement. These read the actual files, so the
 * day somebody imports the news service into the polling path to save a fetch,
 * the suite says no. Same technique the private queue uses for its own
 * never-in-state property.
 */
describe('structural: news stays off the polling path', () => {
  const read = (p: string) => readFileSync(resolve(import.meta.dirname, p), 'utf8')

  it('draft-service does not import the news service', () => {
    expect(read('../server/draft-service.ts')).not.toMatch(/from ['"].*news-service['"]/)
  })

  it('the polling fingerprint does not import news at all', () => {
    expect(read('./version.ts')).not.toMatch(/news/i)
  })

  /**
   * The one piece of availability data that DOES ride on /api/state is the open
   * lot's stored injury column — a join that already existed, no provider on
   * the request path. That is the documented exception; a `fetch(` appearing in
   * draft-service would not be.
   */
  it('draft-service performs no outbound fetch', () => {
    expect(read('../server/draft-service.ts')).not.toMatch(/\bfetch\(/)
  })
})
