'use client'

import { useRef, useState } from 'react'

/**
 * The Oracle's question bar (docs/ANALYTICS_ROADMAP.md §A, step 43).
 *
 * Each question stands alone: earlier turns are kept on screen for the session and are
 * NOT sent back to the server. The SQL and the rows are always shown beneath the answer,
 * because the point of the page is that anyone can check how a number was worked out.
 */

interface Step {
  sql: string
  ok: boolean
  columns: string[]
  rows: unknown[][]
  truncated: boolean
  error: string | null
}

interface Turn {
  id: number
  question: string
  answer: string | null
  error: string | null
  steps: Step[]
}

const EXAMPLES = [
  'How many times has Josh Allen scored over 20 points?',
  'Who has the most 150-point weeks?',
  'What is the most anyone has paid for a running back?',
  'Who has lost the most games by under five points?',
  'Which player has been started the most weeks?',
  'Who has the best playoff record?',
]

const KEEP_TURNS = 5
const ROWS_SHOWN = 20

export function OracleBar() {
  const [question, setQuestion] = useState('')
  const [working, setWorking] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [remaining, setRemaining] = useState<number | null>(null)
  const nextId = useRef(1)
  const input = useRef<HTMLInputElement>(null)

  async function ask(q: string) {
    const text = q.trim()
    if (text.length < 3 || working) return
    setWorking(text)
    let turn: Turn
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: text }),
      })
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean
        answer?: string | null
        steps?: Step[]
        error?: string | null
        reason?: string
        remaining?: number
      } | null

      if (typeof body?.remaining === 'number') setRemaining(body.remaining)
      // 401 / 400 / 429 carry `reason`; an Oracle failure carries `error`. Either is
      // already a sentence. Never show a status code.
      const message = body?.ok ? null : (body?.reason ?? body?.error ?? 'Something went wrong. Try again.')
      turn = {
        id: nextId.current++,
        question: text,
        answer: body?.ok ? (body.answer ?? null) : null,
        error: message,
        steps: body?.steps ?? [],
      }
    } catch {
      turn = {
        id: nextId.current++,
        question: text,
        answer: null,
        error: 'Could not reach the server. Check your connection and try again.',
        steps: [],
      }
    }
    setTurns((prev) => [turn, ...prev].slice(0, KEEP_TURNS))
    setWorking(null)
    setQuestion('')
    input.current?.focus()
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void ask(question)
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <label htmlFor="oracle-question" className="sr-only">
          Your question
        </label>
        <input
          id="oracle-question"
          ref={input}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={working !== null}
          maxLength={500}
          placeholder="Ask anything about this league’s record…"
          className="min-w-0 flex-1 rounded border border-rule-strong bg-transparent px-3 py-2 text-base text-slate-100 placeholder:text-slate-500 disabled:opacity-60"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={working !== null || question.trim().length < 3}
          className="rounded border border-rule-strong px-4 py-2 font-display text-sm font-semibold uppercase tracking-[0.1em] text-slate-100 hover:bg-slate-800 disabled:opacity-50"
        >
          {working ? 'Asking…' : 'Ask'}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2" aria-label="Example questions">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            disabled={working !== null}
            onClick={() => {
              setQuestion(ex)
              input.current?.focus()
            }}
            className="rounded-full border border-rule px-3 py-1 text-left text-xs text-slate-400 hover:text-slate-100 disabled:opacity-50"
          >
            {ex}
          </button>
        ))}
      </div>

      {remaining !== null && (
        <p className="mt-3 text-xs text-slate-500">
          {remaining} {remaining === 1 ? 'question' : 'questions'} left in the last 24 hours.
        </p>
      )}

      <div className="mt-6 space-y-8" aria-live="polite">
        {working && (
          <article>
            <p className="font-display text-sm font-semibold uppercase tracking-[0.08em] text-slate-300">
              {working}
            </p>
            <p className="mt-2 italic text-slate-400">The Oracle is consulting the record…</p>
          </article>
        )}
        {turns.map((t) => (
          <article key={t.id} className="border-t border-rule pt-4">
            <p className="font-display text-sm font-semibold uppercase tracking-[0.08em] text-slate-300">
              {t.question}
            </p>
            {t.answer ? (
              <p className="mt-2 text-lg leading-relaxed text-slate-100">{t.answer}</p>
            ) : (
              <p className="mt-2 text-lg leading-relaxed text-amber-300">{t.error}</p>
            )}
            {t.steps.length > 0 && <HowWorkedOut steps={t.steps} />}
          </article>
        ))}
      </div>
    </div>
  )
}

function HowWorkedOut({ steps }: { steps: Step[] }) {
  return (
    <details className="mt-3 text-sm text-slate-400">
      <summary className="cursor-pointer select-none">How this was worked out</summary>
      <ol className="mt-3 space-y-4">
        {steps.map((s, i) => (
          <li key={i}>
            <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-slate-900 p-3 font-mono text-xs text-slate-200">
              {s.sql}
            </pre>
            {s.error ? (
              <p className="mt-1 text-amber-300">Refused: {s.error}</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead>
                    <tr>
                      {s.columns.map((c) => (
                        <th key={c} className="border-b border-rule px-2 py-1 font-semibold">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.rows.slice(0, ROWS_SHOWN).map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td key={c} className="px-2 py-1 tabular-nums">
                            {cell === null ? '—' : String(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(s.rows.length > ROWS_SHOWN || s.truncated) && (
                  <p className="mt-1 text-slate-500">
                    {s.truncated
                      ? `More than ${s.rows.length} rows matched; showing the first ${ROWS_SHOWN}.`
                      : `${s.rows.length} rows; showing the first ${ROWS_SHOWN}.`}
                  </p>
                )}
                {s.rows.length === 0 && <p className="mt-1 text-slate-500">No rows.</p>}
              </div>
            )}
          </li>
        ))}
      </ol>
    </details>
  )
}
