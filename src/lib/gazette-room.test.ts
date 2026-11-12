import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { GazetteFacts } from './gazette'
import { validateDesk, type DeskOutput, type Storyline } from './gazette-room'

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
