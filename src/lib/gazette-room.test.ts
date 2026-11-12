import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GazetteFacts } from './gazette'
import {
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
