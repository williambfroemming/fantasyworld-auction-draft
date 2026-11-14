import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GazetteFacts } from './gazette'
import {
  BANNED_PHRASES,
  blindLabels,
  judgeSeed,
  onlySurvivor,
  seededRandom,
  validateGameNotes,
  validateVerdict,
  bannedPhrases,
  cleanDraft,
  isDalesFirstIssue,
  planPaths,
  recentlyLed,
  validateDesk,
  validatePlans,
  type Beat,
  type DeskOutput,
  type Plan,
  type RecentLead,
  type Storyline,
} from './gazette-room'
import { PROMPT } from '../../scripts/history/gazette-prompt'
import { EXEMPLARS, VOICE } from '../../scripts/history/gazette-room/voice'
import { WRITER_PROMPT } from '../../scripts/history/gazette-room/writer-prompt'

const archive = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../data/history/gazette/2025.json'), 'utf8'),
) as { issues: Record<string, { facts: GazetteFacts }> }
const pack = archive.issues['10'].facts

const g0 = pack.games[0]

function story(over: Partial<Storyline> = {}): Storyline {
  return {
    id: 'nate-rolls-on',
    managers: [g0.winner!],
    evidence: ['games[0]', 'standings[0]'],
    whyTheChatCares: `${g0.winner} put up ${g0.winnerPoints} and nobody noticed.`,
    possibleTakes: ['He is better than his record says.', 'He is exactly as good as his record says.'],
    heat: 7,
    ...over,
  }
}

function desk(storylines: Storyline[], stale: DeskOutput['stale'] = []): DeskOutput {
  return { storylines, stale }
}

const five = (over: Partial<Storyline> = {}) =>
  ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map((w, i) => story({ id: `story-${w}`, ...(i === 0 ? over : {}) }))

describe('validateDesk', () => {
  it('passes a well-formed desk', () => {
    expect(validateDesk(desk(five()), pack)).toEqual([])
  })

  it('rejects a path that is not in the pack, and names it', () => {
    const problems = validateDesk(desk(five({ evidence: ['games[0]', 'games[42]'] })), pack)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('games[42]')
  })

  it('rejects a figure the pack cannot account for, in any prose field', () => {
    const inWhy = validateDesk(desk(five({ whyTheChatCares: 'He scored 987.65 points.' })), pack)
    expect(inWhy.join()).toContain('987.65')
    const inTake = validateDesk(desk(five({ possibleTakes: ['Worth 4321 of anyone.'] })), pack)
    expect(inTake.join()).toContain('4321')
    const inStale = validateDesk(desk(five(), [{ description: 'The 8888 bit.', lastIssueWeek: 9 }]), pack)
    expect(inStale.join()).toContain('8888')
  })

  it('rejects a manager the league does not have', () => {
    expect(validateDesk(desk(five({ managers: ['Gordon'] })), pack).join()).toContain('Gordon')
  })

  it('rejects ids with digits or capitals, and duplicates', () => {
    expect(validateDesk(desk(five({ id: 'story-2' })), pack).join()).toContain('lowercase')
    expect(validateDesk(desk(five({ id: 'Story-alpha' })), pack).join()).toContain('lowercase')
    const dup = five()
    dup[1] = { ...dup[1], id: dup[0].id }
    expect(validateDesk(desk(dup), pack).join()).toContain('duplicate')
  })

  it('rejects too few or too many storylines', () => {
    expect(validateDesk(desk(five().slice(0, 2)), pack).join()).toContain('not 2')
    const many = Array.from({ length: 11 }, (_, i) => story({ id: `story-${'abcdefghijk'[i]}` }))
    expect(validateDesk(desk(many), pack).join()).toContain('not 11')
  })

  it('rejects empty evidence, no managers, and heat off the scale', () => {
    expect(validateDesk(desk(five({ evidence: [] })), pack).join()).toContain('no evidence')
    expect(validateDesk(desk(five({ managers: [] })), pack).join()).toContain('no manager')
    expect(validateDesk(desk(five({ heat: 11 })), pack).join()).toContain('heat')
  })
})

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const deskOf = (): DeskOutput =>
  desk([
    story({ id: 'about-mario', managers: ['Mario', 'Bryan'], evidence: ['games[0]', 'rosters[0]'] }),
    story({ id: 'about-bryan', managers: ['Bryan'], evidence: ['games[1]'] }),
    story({ id: 'about-jack', managers: ['Jack'], evidence: ['games[2]'] }),
    story({ id: 'about-nate', managers: ['Nate'], evidence: ['standings[0]'] }),
    story({ id: 'about-bill', managers: ['Bill'], evidence: ['stats[0]'] }),
  ])

const beat = (storylineId: string, over: Partial<Beat> = {}): Beat => ({
  storylineId,
  mode: 'roast',
  take: 'He is a fraud.',
  jokePremise: 'Paying for a running back like it is a mortgage.',
  figures: [],
  ...over,
})

const plan = (lead: string, over: Partial<Plan> = {}): Plan => ({
  lead,
  headlineAngle: 'A croquet mallet to the shins.',
  coldOpenPremise: 'The Queen of Hearts rules the standings.',
  beats: [beat(lead), beat('about-bill'), beat('about-nate', { mode: 'gutPunch' }), beat('about-jack', { mode: 'prediction' })],
  close: 'Nobody is safe next week.',
  dalesStance: 'The standings are lying about everyone.',
  ...over,
})

const three = () => ({ plans: [plan('about-mario'), plan('about-bryan'), plan('about-jack')] })

describe('recentlyLed', () => {
  const lead = (week: number, manager?: string): RecentLead => ({
    week,
    headline: 'x',
    lead: manager ? { storylineId: 'x', managers: [manager, 'Someone'] } : undefined,
  })

  it('takes the primary manager of the last two issues only', () => {
    expect([...recentlyLed([lead(5, 'Nate'), lead(6, 'Mario'), lead(7, 'Jack')])].sort()).toEqual(['Jack', 'Mario'])
  })

  it('an issue without a recorded lead contributes nobody, and is not skipped past', () => {
    // Week 7 was single-pass: only week 6's lead is barred, week 5's is not reached for.
    expect([...recentlyLed([lead(5, 'Nate'), lead(6, 'Mario'), lead(7)])]).toEqual(['Mario'])
    expect(recentlyLed([lead(6), lead(7)]).size).toBe(0)
    expect(recentlyLed([]).size).toBe(0)
  })

  it('orders by week, whatever order it is handed', () => {
    expect([...recentlyLed([lead(7, 'Jack'), lead(5, 'Nate'), lead(6, 'Mario')])].sort()).toEqual(['Jack', 'Mario'])
  })
})

describe('validatePlans', () => {
  it('passes three distinct, well-formed plans', () => {
    expect(validatePlans(three(), deskOf(), pack, [])).toEqual([])
  })

  it('wants exactly three plans with different leads', () => {
    expect(validatePlans({ plans: three().plans.slice(0, 2) }, deskOf(), pack, []).join()).toContain('exactly 3')
    const same = { plans: [plan('about-mario'), plan('about-mario'), plan('about-jack')] }
    expect(validatePlans(same, deskOf(), pack, []).join()).toContain('different leads')
  })

  it('refuses a lead about a man who led either of the last two issues', () => {
    const recent: RecentLead[] = [
      { week: 6, headline: 'x', lead: { storylineId: 'old', managers: ['Mario'] } },
      { week: 7, headline: 'y' },
    ]
    const problems = validatePlans(three(), deskOf(), pack, recent)
    expect(problems).toHaveLength(1)
    expect(problems[0]).toMatch(/plan 1: leads with Mario/)
  })

  it('refuses an unknown storyline, an unknown path and an ungrounded figure', () => {
    const bad = three()
    bad.plans[0] = plan('about-nobody')
    bad.plans[1] = plan('about-bryan', { beats: [beat('about-bryan', { figures: ['games[77]' ] }), beat('about-bill'), beat('about-nate'), beat('about-jack')] })
    bad.plans[2] = plan('about-jack', { dalesStance: 'Jack is worth 7777 of anyone.' })
    const problems = validatePlans(bad, deskOf(), pack, []).join('\n')
    expect(problems).toContain('"about-nobody" is not a storyline id')
    expect(problems).toContain('games[77]')
    expect(problems).toContain('7777')
  })

  it('wants four to seven beats, one of which covers the lead', () => {
    const short = three()
    short.plans[0] = plan('about-mario', { beats: [beat('about-mario'), beat('about-bill')] })
    expect(validatePlans(short, deskOf(), pack, []).join()).toContain('not 2')
    const orphan = three()
    orphan.plans[0] = plan('about-mario', { beats: [beat('about-bill'), beat('about-nate'), beat('about-jack'), beat('about-bryan')] })
    expect(validatePlans(orphan, deskOf(), pack, []).join()).toContain('no beat covers its own lead')
  })

  it('refuses an empty stance', () => {
    const p = three()
    p.plans[2] = plan('about-jack', { dalesStance: '  ' })
    expect(validatePlans(p, deskOf(), pack, []).join()).toContain('no stance')
  })
})

describe('planPaths', () => {
  it('is the evidence of every storyline the plan touches plus its beat figures, once each', () => {
    const p = plan('about-mario', {
      beats: [beat('about-mario', { figures: ['games[0].margin', 'belt'] }), beat('about-bryan'), beat('about-bryan'), beat('about-mario')],
    })
    expect(planPaths(p, deskOf())).toEqual(['games[0]', 'rosters[0]', 'games[1]', 'games[0].margin', 'belt'])
  })
})

// ---------------------------------------------------------------------------
// Writers: the voice bible and the lint
// ---------------------------------------------------------------------------

describe('the voice bible', () => {
  /** A section of a prompt: from its heading to the next blank line. */
  const block = (prompt: string, heading: string) => {
    const start = prompt.indexOf(heading)
    expect(start, heading).toBeGreaterThanOrEqual(0)
    const end = prompt.indexOf('\n\n', start)
    return prompt.slice(start, end === -1 ? undefined : end)
  }

  it.each(['THE NUMBER CONTRACT', 'WHAT YOU CANNOT KNOW', 'THE FLOOR'])(
    '%s is carried over from v16 word for word',
    (heading) => {
      // These are rules, not voice (docs/GAZETTE_ROADMAP.md, locked decisions).
      expect(VOICE).toContain(block(PROMPT, heading))
    },
  )

  it('prints every banned phrase, from the same list the lint uses', () => {
    for (const p of BANNED_PHRASES) expect(VOICE).toContain(`"${p}"`)
  })

  it('leaves EXEMPLARS for the commissioner, and out of the prompt while empty', () => {
    expect(EXEMPLARS).toEqual([])
    expect(VOICE).not.toContain('EXEMPLARS')
    const src = readFileSync(resolve(import.meta.dirname, '../../scripts/history/gazette-room/voice.ts'), 'utf8')
    expect(src).toMatch(/TODO\(commissioner\)/)
  })

  it('the Writer prompt is the bible plus the assignment', () => {
    expect(WRITER_PROMPT.startsWith(VOICE)).toBe(true)
    expect(WRITER_PROMPT).toContain('DALESSTANCE')
    expect(WRITER_PROMPT).not.toMatch(/GAMENOTES/)
  })
})

describe('bannedPhrases', () => {
  it('finds phrases case-insensitively, curly apostrophes included, once each', () => {
    expect(bannedPhrases('To be fair, it was Respectable. to be fair.')).toEqual(['to be fair', 'respectable'])
    expect(bannedPhrases('Let’s be honest about Bryan.')).toEqual(["let's be honest"])
  })

  it('is silent on clean prose', () => {
    expect(bannedPhrases('Bryan benched a guy who scored twenty for a guy who scored two.')).toEqual([])
  })
})

describe('isDalesFirstIssue', () => {
  it('is true until the notebook has an entry of his', () => {
    expect(isDalesFirstIssue([])).toBe(true)
    expect(isDalesFirstIssue([{ id: 'gordon-belt', kind: 'bit', note: 'x' }])).toBe(true)
    expect(isDalesFirstIssue([{ id: 'dale-phrases', kind: 'arc', note: 'x' }])).toBe(false)
  })
})

describe('cleanDraft', () => {
  it('strips the markup a model reaches for, from every prose field', () => {
    const d = cleanDraft({
      issueTitle: '<b>T</b>',
      lens: 'L',
      headline: '<em>H</em>',
      deck: '<i>D</i>',
      column: '<p>C</p>',
      threads: [],
    })
    expect([d.issueTitle, d.headline, d.deck, d.column]).toEqual(['T', 'H', 'D', 'C'])
  })
})

// ---------------------------------------------------------------------------
// Judge and game notes
// ---------------------------------------------------------------------------

describe('blindLabels', () => {
  it('labels A, B, C in a seeded order, the same every time for the same week', () => {
    const a = blindLabels(['p1', 'p2', 'p3'], judgeSeed(2025, 7))
    const b = blindLabels(['p1', 'p2', 'p3'], judgeSeed(2025, 7))
    expect(a).toEqual(b)
    expect(a.map((x) => x.label)).toEqual(['A', 'B', 'C'])
    expect(a.map((x) => x.item).sort()).toEqual(['p1', 'p2', 'p3'])
  })

  it('does not always put plan one under A', () => {
    // Over a season of seeds, every plan gets to be A sometimes; a judge that
    // learned "A is the editor's first idea" would be learning a leak.
    const firsts = new Set<string>()
    for (let w = 1; w <= 17; w++) firsts.add(blindLabels(['p1', 'p2', 'p3'], judgeSeed(2025, w))[0].item)
    expect(firsts.size).toBe(3)
  })

  it('handles one and two survivors', () => {
    expect(blindLabels(['only'], 1)).toEqual([{ label: 'A', item: 'only' }])
    expect(blindLabels(['x', 'y'], 2).map((l) => l.label)).toEqual(['A', 'B'])
  })

  it('the seed is season x 100 + week', () => {
    expect(judgeSeed(2025, 7)).toBe(202507)
  })

  it('seededRandom is deterministic and in [0, 1)', () => {
    const r1 = seededRandom(42)
    const r2 = seededRandom(42)
    for (let i = 0; i < 50; i++) {
      const v = r1()
      expect(v).toBe(r2())
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('validateVerdict', () => {
  const ok = { ranking: ['B', 'A', 'C'], winner: 'B', reasons: 'B is funnier.', flaggedLines: [] }

  it('passes a full ranking led by the winner', () => {
    expect(validateVerdict(ok, ['A', 'B', 'C'])).toEqual([])
  })

  it('wants every label exactly once, and the winner first', () => {
    expect(validateVerdict({ ...ok, ranking: ['B', 'A'] }, ['A', 'B', 'C']).join()).toContain('exactly once')
    expect(validateVerdict({ ...ok, ranking: ['B', 'B', 'C'] }, ['A', 'B', 'C']).join()).toContain('exactly once')
    expect(validateVerdict({ ...ok, winner: 'A' }, ['A', 'B', 'C']).join()).toContain('first label')
    expect(validateVerdict({ ...ok, winner: 'D', ranking: ['D', 'A', 'B'] }, ['A', 'B', 'C']).join()).toContain('"D"')
  })

  it('refuses a flag on a label that does not exist, and empty reasons', () => {
    const flagged = { ...ok, flaggedLines: [{ label: 'Q', line: 'x', why: 'y' }] }
    expect(validateVerdict(flagged, ['A', 'B', 'C']).join()).toContain('"Q"')
    expect(validateVerdict({ ...ok, reasons: ' ' }, ['A', 'B', 'C']).join()).toContain('REASONS')
  })

  it('a lone survivor is recorded as such, and is itself a valid verdict', () => {
    const v = onlySurvivor('A')
    expect(v.reasons).toBe('only survivor')
    expect(validateVerdict(v, ['A'])).toEqual([])
  })
})

describe('validateGameNotes', () => {
  it('wants one non-empty note per game', () => {
    expect(validateGameNotes(['a', 'b'], 2)).toEqual([])
    expect(validateGameNotes(['a'], 2).join()).toContain('exactly 2')
    expect(validateGameNotes(['a', ' '], 2).join()).toContain('note 2 is empty')
  })
})
