import { describe, expect, it } from 'vitest'
import {
  UNRANKED_SENTINEL,
  injurySeverity,
  normalizePool,
  parseCsvPool,
  playerMatchKey,
  readInjury,
  resolveSleeperIds,
  sortForBoard,
  type PoolPlayer,
  type SleeperPlayer,
} from './sleeper'

describe('normalizePool', () => {
  const raw: Record<string, SleeperPlayer> = {
    '4046': { player_id: '4046', full_name: 'Patrick Mahomes', team: 'KC', position: 'QB', active: true, search_rank: 12 },
    PHI: { player_id: 'PHI', team: 'PHI', position: 'DEF', search_rank: null },
    '9999': { player_id: '9999', full_name: 'Some Linebacker', team: 'NYJ', position: 'LB', active: true, search_rank: 400 },
    '8888': { player_id: '8888', full_name: 'Retired Guy', team: null, position: 'WR', active: false, search_rank: 900 },
    '7777': { player_id: '7777', full_name: 'Unranked Rookie', team: 'LV', position: 'RB', active: true, search_rank: UNRANKED_SENTINEL },
  }

  it('keeps only draftable positions, dropping IDP', () => {
    const pool = normalizePool(raw)
    expect(pool.find((p) => p.name === 'Some Linebacker')).toBeUndefined()
    expect(pool.find((p) => p.name === 'Patrick Mahomes')).toBeDefined()
  })

  it('builds a readable name for team defenses, which Sleeper keys by team code', () => {
    const def = normalizePool(raw).find((p) => p.position === 'DEF')
    expect(def?.name).toBe('PHI Defense')
    expect(def?.team).toBe('PHI')
    expect(def?.active).toBe(true) // a defense is always draftable
  })

  it('treats the 9999999 sentinel as unranked rather than a real rank', () => {
    // Verified against the live API: Sleeper uses 9999999, not null, for unranked.
    // Left raw it would render as "#9999999" and pollute any numeric sort.
    const rookie = normalizePool(raw).find((p) => p.name === 'Unranked Rookie')
    expect(rookie?.searchRank).toBeNull()
  })

  it('preserves the active flag so inactive players can be filtered out', () => {
    expect(normalizePool(raw).find((p) => p.name === 'Retired Guy')?.active).toBe(false)
  })
})

describe('sortForBoard', () => {
  const p = (name: string, position: string, searchRank: number | null) => ({
    id: name, name, team: null, position: position as never, searchRank, active: true,
  })

  it('puts unranked players last, not first', () => {
    const out = sortForBoard([p('Unranked', 'WR', null), p('Ranked', 'WR', 50)])
    expect(out.map((x) => x.name)).toEqual(['Ranked', 'Unranked'])
  })

  it('breaks ties deterministically instead of arbitrarily', () => {
    // Sleeper genuinely gives several players the same rank — 318 ranks are
    // shared by 2+ players. Without a tiebreak the board order is unstable.
    const out = sortForBoard([p('Zeta', 'RB', 5), p('Alpha', 'RB', 5), p('Quinn', 'QB', 5)])
    expect(out.map((x) => x.name)).toEqual(['Quinn', 'Alpha', 'Zeta'])
  })

  it('does not mutate its input', () => {
    const input = [p('B', 'WR', 2), p('A', 'WR', 1)]
    sortForBoard(input)
    expect(input[0].name).toBe('B')
  })
})

describe('parseCsvPool', () => {
  it('parses a ranked list with a header row', () => {
    const out = parseCsvPool("Name,Team,Position,Rank\nJa'Marr Chase,CIN,WR,1\nBijan Robinson,ATL,RB,2")
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ name: "Ja'Marr Chase", team: 'CIN', position: 'WR', searchRank: 1 })
  })

  it('works without a header and falls back to file order for rank', () => {
    const out = parseCsvPool('Josh Allen,BUF,QB\nLamar Jackson,BAL,QB')
    expect(out.map((p) => p.name)).toEqual(['Josh Allen', 'Lamar Jackson'])
    expect(out[0].searchRank).toBe(1)
  })

  it('normalizes the many spellings of a team defense', () => {
    // The old sheet used "DS"; other exports use DST or D/ST.
    for (const spelling of ['DST', 'D/ST', 'DS', 'DEF']) {
      const out = parseCsvPool(`Philadelphia Eagles,PHI,${spelling},1`)
      expect(out[0]?.position).toBe('DEF')
    }
  })

  it('handles quoted fields containing commas', () => {
    const out = parseCsvPool('"Smith, Jr., Steve",CAR,WR,4')
    expect(out[0].name).toBe('Smith, Jr., Steve')
    expect(out[0].team).toBe('CAR')
  })

  it('skips blank lines and unknown positions', () => {
    const out = parseCsvPool('Name,Team,Position,Rank\n\nGuy,NYJ,LB,1\nReal,KC,TE,2\n')
    expect(out.map((p) => p.name)).toEqual(['Real'])
  })

  describe('FantasyPros export — the real input format', () => {
    // Verbatim shape of FantasyPros_2026_Draft_ALL_Rankings.csv, including the
    // trailing spaces in "UPSIDE " and the positional rank baked into POS.
    const FP = [
      '"RK",TIERS,"PLAYER NAME",TEAM,"POS","BYE WEEK","UPSIDE ","BUST ","SOS SEASON","ECR VS. ADP"',
      '"1",1,"Ja\'Marr Chase",CIN,"WR1","6","5 out of 5","1 out of 5","4 out of 5 stars","+2"',
      '"156",9,"Houston Texans",HOU,"DST1","8","-","-","2 out of 5 stars","-52"',
      '"200",12,"Cameron Dicker",LAC,"K3","-","-","-","-","-"',
    ].join('\n')

    it('reads rank, team, bye and splits the positional rank out of POS', () => {
      const out = parseCsvPool(FP)
      expect(out[0]).toMatchObject({
        name: "Ja'Marr Chase",
        team: 'CIN',
        position: 'WR',
        searchRank: 1,
        posRank: 1,
        byeWeek: 6,
      })
    })

    it('maps DST to DEF so defenses are draftable', () => {
      const def = parseCsvPool(FP).find((p) => p.position === 'DEF')
      expect(def).toMatchObject({ name: 'Houston Texans', team: 'HOU', posRank: 1, searchRank: 156 })
    })

    it('treats "-" as missing rather than parsing it as a number', () => {
      // FantasyPros uses "-" for absent bye weeks and ratings.
      const k = parseCsvPool(FP).find((p) => p.position === 'K')
      expect(k?.byeWeek).toBeNull()
      expect(k?.posRank).toBe(3)
    })

    it('finds columns by header name, not position, so a reorder is harmless', () => {
      const reordered = ['TEAM,"POS","PLAYER NAME","RK"', 'CIN,"WR1","Ja\'Marr Chase","1"'].join('\n')
      expect(parseCsvPool(reordered)[0]).toMatchObject({
        name: "Ja'Marr Chase",
        team: 'CIN',
        position: 'WR',
        searchRank: 1,
      })
    })

    it('drops opinionated columns the league does not want on the board', () => {
      // Deliberate: no auction values and no tiers. Both are one source's
      // opinion, and managers bring their own. They are dropped on import
      // rather than stored and hidden, so they cannot leak onto the board.
      const opinionated = [
        '"RK",TIERS,"PLAYER NAME",TEAM,"POS","Auction Value"',
        '"1",1,"Ja\'Marr Chase",CIN,"WR1","$62"',
      ].join('\n')
      const parsed = parseCsvPool(opinionated)[0]
      expect(parsed.name).toBe("Ja'Marr Chase")
      expect(parsed.searchRank).toBe(1)
      expect(Object.keys(parsed)).not.toContain('auctionValue')
      expect(Object.keys(parsed)).not.toContain('tier')
    })
  })
})

describe('playerMatchKey', () => {
  it('folds away the punctuation the two sources disagree about', () => {
    // The apostrophe, the periods, and the hyphen are the three biggest causes
    // of a naive-equality miss between a FantasyPros export and Sleeper.
    expect(playerMatchKey("Ja'Marr Chase", 'WR')).toBe(playerMatchKey('JaMarr Chase', 'WR'))
    expect(playerMatchKey('A.J. Brown', 'WR')).toBe(playerMatchKey('AJ Brown', 'WR'))
    expect(playerMatchKey('Jaxon Smith-Njigba', 'WR')).toBe(
      playerMatchKey('Jaxon Smith Njigba', 'WR'),
    )
  })

  it('strips generational suffixes', () => {
    expect(playerMatchKey('Marvin Harrison Jr.', 'WR')).toBe(playerMatchKey('Marvin Harrison', 'WR'))
    expect(playerMatchKey('Odell Beckham Jr', 'WR')).toBe(playerMatchKey('Odell Beckham', 'WR'))
    expect(playerMatchKey('Michael Pittman II', 'WR')).toBe(playerMatchKey('Michael Pittman', 'WR'))
  })

  it('does not strip a suffix that is part of the name', () => {
    // "V" as a surname initial, not a generational suffix, would be a real
    // false positive -- guard the shape rather than only the happy path.
    expect(playerMatchKey('Vita Vea', 'DEF')).toBe('vitavea|DEF')
  })

  it('keeps position in the key, so a name collision across positions stays apart', () => {
    expect(playerMatchKey('Josh Allen', 'QB')).not.toBe(playerMatchKey('Josh Allen', 'LB'))
  })
})

describe('resolveSleeperIds', () => {
  const sleeperPlayer = (over: Partial<PoolPlayer> & { id: string }): PoolPlayer => ({
    name: 'Somebody',
    team: 'PHI',
    position: 'WR',
    searchRank: 1,
    active: true,
    ...over,
  })

  it('matches on name and position across punctuation and suffixes', () => {
    const sleeper = [sleeperPlayer({ id: '4046', name: "Ja'Marr Chase", team: 'CIN', position: 'WR' })]
    const pool = [
      sleeperPlayer({ id: 'csv-jamarr-chase-WR', name: 'JaMarr Chase', team: 'CIN', position: 'WR' }),
    ]
    expect(resolveSleeperIds(pool, sleeper).get('csv-jamarr-chase-WR')).toBe('4046')
  })

  /**
   * Sleeper synthesises "PHI Defense" and keys the row by team abbreviation; a
   * rankings CSV says "Philadelphia Eagles". Those never match as strings, and
   * the team code always does.
   */
  /**
   * Found by the real 2026 backfill: 159 of 160 picks resolved, and the miss
   * was Jacksonville. FantasyPros writes JAC, Sleeper writes JAX -- and since
   * defenses match on team code ALONE, a spelling divergence is a guaranteed
   * miss rather than a probable one.
   */
  it('matches a defense across a team-code spelling difference', () => {
    const sleeper = [sleeperPlayer({ id: 'JAX', name: 'JAX Defense', team: 'JAX', position: 'DEF' })]
    const pool = [
      sleeperPlayer({
        id: 'csv-jacksonville-jaguars-DEF',
        name: 'Jacksonville Jaguars',
        team: 'JAC',
        position: 'DEF',
      }),
    ]
    expect(resolveSleeperIds(pool, sleeper).get('csv-jacksonville-jaguars-DEF')).toBe('JAX')
  })

  it('matches defenses on team code, never on name', () => {
    const sleeper = [sleeperPlayer({ id: 'PHI', name: 'PHI Defense', team: 'PHI', position: 'DEF' })]
    const pool = [
      sleeperPlayer({
        id: 'csv-philadelphia-eagles-DEF',
        name: 'Philadelphia Eagles',
        team: 'PHI',
        position: 'DEF',
      }),
    ]
    expect(resolveSleeperIds(pool, sleeper).get('csv-philadelphia-eagles-DEF')).toBe('PHI')
  })

  it('uses team to separate two players who share a name and position', () => {
    const sleeper = [
      sleeperPlayer({ id: 'a', name: 'Mike Williams', team: 'NYJ', position: 'WR' }),
      sleeperPlayer({ id: 'b', name: 'Mike Williams', team: 'LAC', position: 'WR' }),
    ]
    const pool = [
      sleeperPlayer({ id: 'csv-mike-williams-WR', name: 'Mike Williams', team: 'LAC', position: 'WR' }),
    ]
    expect(resolveSleeperIds(pool, sleeper).get('csv-mike-williams-WR')).toBe('b')
  })

  /**
   * The important negative. Guessing between two same-named players would
   * silently attribute one player's price history to the other -- a wrong
   * answer that looks exactly like a right one.
   */
  it('refuses to guess when a name and position are ambiguous and the team does not help', () => {
    const sleeper = [
      sleeperPlayer({ id: 'a', name: 'Mike Williams', team: 'NYJ', position: 'WR' }),
      sleeperPlayer({ id: 'b', name: 'Mike Williams', team: 'LAC', position: 'WR' }),
    ]
    // Traded since the CSV was cut, so the team matches neither.
    const pool = [
      sleeperPlayer({ id: 'csv-mike-williams-WR', name: 'Mike Williams', team: 'PIT', position: 'WR' }),
    ]
    expect(resolveSleeperIds(pool, sleeper).has('csv-mike-williams-WR')).toBe(false)
  })

  it('falls back to name and position when the team has changed but the name is unique', () => {
    const sleeper = [sleeperPlayer({ id: '99', name: 'Saquon Barkley', team: 'NYG', position: 'RB' })]
    const pool = [
      sleeperPlayer({ id: 'csv-saquon-barkley-RB', name: 'Saquon Barkley', team: 'PHI', position: 'RB' }),
    ]
    expect(resolveSleeperIds(pool, sleeper).get('csv-saquon-barkley-RB')).toBe('99')
  })

  it('leaves a player with no counterpart unresolved rather than inventing one', () => {
    const sleeper = [sleeperPlayer({ id: '1', name: 'Real Player', position: 'WR' })]
    const pool = [sleeperPlayer({ id: 'csv-nobody-WR', name: 'Nobody At All', position: 'WR' })]
    expect(resolveSleeperIds(pool, sleeper).size).toBe(0)
  })

  it('lets an override win outright, including over an ambiguous match', () => {
    const sleeper = [
      sleeperPlayer({ id: 'a', name: 'Mike Williams', team: 'NYJ', position: 'WR' }),
      sleeperPlayer({ id: 'b', name: 'Mike Williams', team: 'LAC', position: 'WR' }),
    ]
    const pool = [
      sleeperPlayer({ id: 'csv-mike-williams-WR', name: 'Mike Williams', team: 'PIT', position: 'WR' }),
    ]
    const got = resolveSleeperIds(pool, sleeper, { 'csv-mike-williams-WR': 'b' })
    expect(got.get('csv-mike-williams-WR')).toBe('b')
  })

  it('does not un-poison an ambiguous key when a third player arrives', () => {
    const sleeper = [
      sleeperPlayer({ id: 'a', name: 'Mike Williams', team: 'NYJ', position: 'WR' }),
      sleeperPlayer({ id: 'b', name: 'Mike Williams', team: 'LAC', position: 'WR' }),
      sleeperPlayer({ id: 'c', name: 'Mike Williams', team: 'SEA', position: 'WR' }),
    ]
    const pool = [
      sleeperPlayer({ id: 'csv-mike-williams-WR', name: 'Mike Williams', team: 'DAL', position: 'WR' }),
    ]
    expect(resolveSleeperIds(pool, sleeper).has('csv-mike-williams-WR')).toBe(false)
  })
})

describe('readInjury', () => {
  it('returns null for a player with nothing to report', () => {
    expect(readInjury({ player_id: '1', full_name: 'Fit Guy' })).toBeNull()
  })

  /**
   * The gate is `injury_status`, not the body part. Sleeper leaves
   * `injury_body_part` populated on players who have since been cleared, so
   * keying off it would keep showing a knee that stopped mattering in March.
   */
  it('reports nothing when only a stale body part survives', () => {
    expect(
      readInjury({ player_id: '1', full_name: 'Cleared Guy', injury_body_part: 'Knee' }),
    ).toBeNull()
  })

  it('carries the detail that actually changes a bid', () => {
    expect(
      readInjury({
        player_id: '1',
        full_name: 'Malik Nabers',
        injury_status: 'Questionable',
        injury_body_part: 'Knee - ACL',
        injury_notes: 'Surgery',
        practice_participation: 'DNP',
        news_updated: 1_755_000_000_000,
      }),
    ).toEqual({
      status: 'Questionable',
      bodyPart: 'Knee - ACL',
      notes: 'Surgery',
      practice: 'DNP',
      newsUpdated: 1_755_000_000_000,
    })
  })

  it('normalises blank strings to null rather than rendering empty detail', () => {
    const r = readInjury({
      player_id: '1',
      full_name: 'X',
      injury_status: 'Out',
      injury_body_part: '   ',
      injury_notes: '',
    })
    expect(r).toEqual({
      status: 'Out',
      bodyPart: null,
      notes: null,
      practice: null,
      newsUpdated: null,
    })
  })
})

describe('injurySeverity', () => {
  it('ranks season-enders above game-time decisions', () => {
    expect(injurySeverity('IR')).toBe(3)
    expect(injurySeverity('PUP')).toBe(3)
    expect(injurySeverity('Out')).toBe(3)
    expect(injurySeverity('Doubtful')).toBe(2)
    expect(injurySeverity('Questionable')).toBe(1)
  })

  it('is case- and space-insensitive', () => {
    expect(injurySeverity('  questionable ')).toBe(1)
    expect(injurySeverity('ir')).toBe(3)
  })

  /**
   * An unrecognised status is more likely to be worth seeing than not, so it
   * lands at 1 rather than 0. Silently ranking a status Sleeper invented last
   * week as "fine" is the wrong direction to fail in.
   */
  it('treats an unknown status as worth showing, not as healthy', () => {
    expect(injurySeverity('Limited Participation In Practice')).toBe(1)
    expect(injurySeverity('Some New Sleeper Status')).toBe(1)
  })

  it('still ranks the explicitly-clear values at zero', () => {
    expect(injurySeverity('NA')).toBe(0)
    expect(injurySeverity('Active')).toBe(0)
  })
})
