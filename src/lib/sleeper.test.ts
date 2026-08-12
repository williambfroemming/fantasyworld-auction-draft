import { describe, expect, it } from 'vitest'
import {
  UNRANKED_SENTINEL,
  normalizePool,
  parseCsvPool,
  sortForBoard,
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
