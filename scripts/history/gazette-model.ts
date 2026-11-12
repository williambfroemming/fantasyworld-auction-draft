/**
 * The one way the Gazette talks to the model: a JSON-schema-constrained call
 * through the Messages API, with token use recorded per stage.
 *
 * Lifted out of gazette.ts when the editorial room arrived (steps 68-71 of
 * docs/GAZETTE_ROADMAP.md), because the room makes five kinds of call where the
 * single-pass edition made one, and gazette.ts cannot be imported by the room
 * without running its own main(). The single-pass path and the season preview
 * call through here too, unchanged in what they send.
 *
 * Structured output rather than a prefill: an assistant prefill returns a 400
 * on this model, and "please reply with JSON" is a request rather than a
 * guarantee.
 *
 * `max_tokens` caps thinking AND response text together, and adaptive thinking
 * is on by default here -- hence the generous ceiling. This is the bug that sat
 * unnoticed in draft-recap.ts, which asked for 400.
 */

export const MODEL = 'claude-opus-5'

export type Effort = 'low' | 'medium' | 'high'

export interface CallSpec {
  /** Which stage this is, for the token ledger: "desk", "writer B", "judge". */
  stage: string
  system: string
  /** The first user turn. Objects are sent as pretty JSON, as the pack always was. */
  user: unknown
  /** Further user turns -- a repair note, for instance. */
  followUps?: string[]
  schema: Record<string, unknown>
  effort: Effort
  maxTokens?: number
}

export interface Usage {
  stage: string
  inputTokens: number
  outputTokens: number
}

/**
 * Every call this process has made, in order. A run prints it per issue, so
 * "what did that edition cost" is answered by the run rather than the bill.
 */
export const ledger: Usage[] = []

/** Claude Opus 5 list prices, $ per million tokens. Printed as an estimate, never billed from. */
const PRICE_IN = 5
const PRICE_OUT = 25

export function requireKey(): string {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    console.error(
      '\n✗ ANTHROPIC_API_KEY is not set, so no issue can be written.\n' +
        '  The fact pack is what the model would receive — print it with --facts.\n',
    )
    process.exit(1)
  }
  return key
}

export async function callJson<T>(spec: CallSpec): Promise<T> {
  const key = requireKey()
  const first = typeof spec.user === 'string' ? spec.user : JSON.stringify(spec.user, null, 2)
  const messages = [first, ...(spec.followUps ?? [])].map((content) => ({ role: 'user', content }))

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      // An edition is five fields and a notebook, and a long one under a
      // demanding frame has run past 8000 -- which arrives as a truncated JSON
      // body rather than an error, so give it room it will not normally use.
      max_tokens: spec.maxTokens ?? 16000,
      system: spec.system,
      output_config: { effort: spec.effort, format: { type: 'json_schema', schema: spec.schema } },
      messages,
    }),
  })
  if (!res.ok) throw new Error(`Anthropic API ${res.status} (${spec.stage}): ${await res.text()}`)
  const body = (await res.json()) as {
    stop_reason?: string
    content: Array<{ type: string; text?: string }>
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  ledger.push({
    stage: spec.stage,
    inputTokens: body.usage?.input_tokens ?? 0,
    outputTokens: body.usage?.output_tokens ?? 0,
  })
  if (body.stop_reason === 'refusal') throw new Error(`the model declined (${spec.stage})`)
  const text = body.content.find((c) => c.type === 'text')?.text?.trim()
  if (!text) throw new Error(`no text in the model response (${spec.stage})`)

  try {
    return JSON.parse(text) as T
  } catch {
    // A truncated body is the likely cause and does not announce itself: the
    // JSON simply stops mid-string, and the parse error names a column number
    // rather than the actual problem. Say which it was.
    throw new Error(
      body.stop_reason === 'max_tokens'
        ? `${spec.stage} ran past max_tokens and came back truncated`
        : `${spec.stage} returned something that is not valid JSON (${text.length} chars)`,
    )
  }
}

/** Print and clear the ledger since `from`. Returns the new mark. */
export function printLedger(from = 0, heading = 'tokens'): number {
  const rows = ledger.slice(from)
  if (!rows.length) return ledger.length
  const by = new Map<string, Usage & { calls: number }>()
  for (const r of rows) {
    const key = r.stage.replace(/ ([A-Z]|\d+)$/, "") // "writer 1" and "writer 2" share a line
    const cur = by.get(key) ?? { stage: key, inputTokens: 0, outputTokens: 0, calls: 0 }
    cur.inputTokens += r.inputTokens
    cur.outputTokens += r.outputTokens
    cur.calls++
    by.set(key, cur)
  }
  let tin = 0
  let tout = 0
  console.log(`  ${heading}:`)
  for (const r of by.values()) {
    tin += r.inputTokens
    tout += r.outputTokens
    console.log(
      `    ${r.stage.padEnd(14)} ${String(r.calls).padStart(2)} call${r.calls === 1 ? ' ' : 's'}` +
        `  in ${String(r.inputTokens).padStart(7)}  out ${String(r.outputTokens).padStart(6)}`,
    )
  }
  const usd = (tin * PRICE_IN + tout * PRICE_OUT) / 1e6
  console.log(`    ${'total'.padEnd(14)} ${String(rows.length).padStart(2)} calls  in ${String(tin).padStart(7)}  out ${String(tout).padStart(6)}  ≈ $${usd.toFixed(2)}`)
  return ledger.length
}
