import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_STEPS, askOracle, type OracleQueryResult } from './oracle-service'

type Reply = { stop_reason: string; content: unknown[]; usage?: { input_tokens: number; output_tokens: number } }

const text = (t: string): Reply => ({
  stop_reason: 'end_turn',
  content: [{ type: 'text', text: t }],
  usage: { input_tokens: 10, output_tokens: 5 },
})
const tool = (id: string, sql: string): Reply => ({
  stop_reason: 'tool_use',
  content: [{ type: 'text', text: 'checking' }, { type: 'tool_use', id, name: 'query', input: { sql } }],
  usage: { input_tokens: 10, output_tokens: 5 },
})

function stubApi(replies: Reply[], status = 200) {
  // The request bodies are inspected loosely: this is a test double, not a contract.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calls: Array<Record<string, any>> = []
  const fn = vi.fn(async (_url: string, init: { body: string }) => {
    calls.push(JSON.parse(init.body))
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)]
    return { ok: status === 200, status, json: async () => reply } as Response
  })
  vi.stubGlobal('fetch', fn)
  return { calls, fn }
}

const okRows = (rows: unknown[][], truncated = false): OracleQueryResult => ({
  ok: true,
  columns: ['n'],
  rows,
  truncated,
  ms: 3,
})

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
})
afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.ANTHROPIC_API_KEY
})

describe('askOracle', () => {
  it('returns a plain answer when the model calls no tool', async () => {
    const { calls } = stubApi([text('Ten managers.')])
    const run = vi.fn()
    const r = await askOracle('How many managers?', run)
    expect(r).toMatchObject({ ok: true, answer: 'Ten managers.', steps: [], error: null })
    expect(run).not.toHaveBeenCalled()
    expect(r.inputTokens).toBe(10)
    expect(r.outputTokens).toBe(5)
    // The request carries the model, the one tool and the rules + views as the system.
    expect(calls[0].model).toBe('claude-sonnet-5-5')
    expect(calls[0].tools).toHaveLength(1)
    expect(calls[0].tools[0].name).toBe('query')
    expect(calls[0].system).toContain('managers(manager_id, name)')
  })

  it('runs a query, sends a well-formed tool_result, then returns the answer', async () => {
    const { calls } = stubApi([tool('tu_1', 'SELECT 1'), text('One.')])
    const run = vi.fn(async () => okRows([[1]]))
    const r = await askOracle('q', run)

    expect(run).toHaveBeenCalledWith('SELECT 1')
    expect(r.ok).toBe(true)
    expect(r.answer).toBe('One.')
    expect(r.steps).toHaveLength(1)
    expect(r.steps[0]).toMatchObject({ sql: 'SELECT 1', ok: true, columns: ['n'], rows: [[1]], error: null })
    expect(r.inputTokens).toBe(20)

    const second = calls[1].messages
    expect(second).toHaveLength(3)
    expect(second[1].role).toBe('assistant')
    expect(second[1].content).toEqual(tool('tu_1', 'SELECT 1').content) // appended unchanged
    expect(second[2].role).toBe('user')
    const block = second[2].content[0]
    expect(block).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1' })
    expect(JSON.parse(block.content)).toMatchObject({ columns: ['n'], rows: [[1]], rowCount: 1 })
    expect(block.is_error).toBeUndefined()
  })

  it('shows the model at most 50 rows and tells it there were more', async () => {
    const { calls } = stubApi([tool('t', 'SELECT n'), text('done')])
    const rows = Array.from({ length: 200 }, (_, i) => [i])
    const r = await askOracle('q', async () => okRows(rows, true))
    const content = JSON.parse(calls[1].messages[2].content[0].content)
    expect(content.rows).toHaveLength(50)
    expect(content.note).toMatch(/first 50/)
    expect(r.steps[0].rows).toHaveLength(200) // the page still gets everything
    expect(r.steps[0].truncated).toBe(true)
  })

  it('passes a refused query back as is_error and carries on', async () => {
    const { calls } = stubApi([tool('t', 'SELECT * FROM x'), text('I could not find that.')])
    const r = await askOracle('q', async () => ({ ok: false, reason: 'The word "drop" is not allowed.' }))
    const block = calls[1].messages[2].content[0]
    expect(block).toMatchObject({ type: 'tool_result', tool_use_id: 't', is_error: true })
    expect(block.content).toContain('not allowed')
    expect(r.ok).toBe(true)
    expect(r.steps[0]).toMatchObject({ ok: false, error: 'The word "drop" is not allowed.' })
  })

  it('stops after MAX_STEPS queries if the model keeps asking for more', async () => {
    stubApi([tool('t', 'SELECT 1')]) // always asks again
    const run = vi.fn(async () => okRows([[1]]))
    const r = await askOracle('q', run)
    expect(MAX_STEPS).toBe(5)
    expect(run).toHaveBeenCalledTimes(5)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('The Oracle could not work that out in five queries.')
    expect(r.steps).toHaveLength(5)
  })

  it('still lets the model answer after its fifth query', async () => {
    stubApi([
      tool('1', 'a'), tool('2', 'b'), tool('3', 'c'), tool('4', 'd'), tool('5', 'e'),
      text('Got it.'),
    ])
    const r = await askOracle('q', async () => okRows([[1]]))
    expect(r.ok).toBe(true)
    expect(r.steps).toHaveLength(5)
  })

  it('fails without throwing when there is no API key', async () => {
    delete process.env.ANTHROPIC_API_KEY
    const { fn } = stubApi([text('x')])
    const r = await askOracle('q', vi.fn())
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/ANTHROPIC_API_KEY/)
    expect(fn).not.toHaveBeenCalled()
  })

  it('fails without throwing on a non-200 from the API, and does not leak the body', async () => {
    stubApi([text('x')], 529)
    const r = await askOracle('q', vi.fn())
    expect(r).toMatchObject({ ok: false, answer: null })
    expect(r.error).toMatch(/529/)
  })

  it('fails without throwing when fetch itself rejects', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const r = await askOracle('q', vi.fn())
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/could not reach/i)
  })

  it('treats a refusal as a failure', async () => {
    stubApi([{ stop_reason: 'refusal', content: [] }])
    const r = await askOracle('q', vi.fn())
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/declined/i)
  })
})
