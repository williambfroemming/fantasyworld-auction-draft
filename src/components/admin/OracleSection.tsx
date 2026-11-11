'use client'

import { useEffect, useState } from 'react'
import { Btn, Section } from './ui'

/**
 * The Oracle's kill-switch and running cost. Moved from /setup unchanged.
 *
 * Talks to `/api/oracle-admin`, not `/api/commish`: the switch has its own
 * route so `/api/ask` can read it on every request without importing the
 * commissioner surface. Not cached anywhere — a cached kill-switch is not one.
 */
interface OracleAdmin {
  enabled: boolean
  changedAt: string | null
  changedBy: string | null
  last24h: { questions: number; inputTokens: number; outputTokens: number }
  allTime: { questions: number; inputTokens: number; outputTokens: number }
  topAskers24h: Array<{ name: string; questions: number }>
}

export function OracleSection({ setMsg }: { setMsg: (m: string) => void }) {
  const [oracle, setOracle] = useState<OracleAdmin | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/oracle-admin')
      .then((r) => r.json())
      .then((d) => d.ok && setOracle(d))
      .catch(() => {})
  }, [])

  async function flip(enabled: boolean) {
    setBusy(true)
    try {
      const res = await fetch('/api/oracle-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      const data = await res.json()
      if (data.ok) {
        setOracle(data)
        setMsg(enabled ? 'The Oracle is on.' : 'The Oracle is off. No new questions will be answered.')
      } else setMsg(data.reason ?? 'Failed')
    } catch {
      setMsg('Network error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      id="oracle"
      title="Ask the Oracle"
      note="Every question spends API credit. Switch it off here if the cost runs away; it takes effect on the next question."
    >
      {oracle === null ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-lg font-semibold">
              {oracle.enabled ? 'On' : 'Off'}
              {oracle.changedBy && (
                <span className="ml-2 text-xs font-normal text-slate-500">switched by {oracle.changedBy}</span>
              )}
            </span>
            <Btn onClick={() => flip(!oracle.enabled)} disabled={busy} tone={oracle.enabled ? 'danger' : 'go'}>
              {oracle.enabled ? 'Turn off' : 'Turn on'}
            </Btn>
          </div>
          <p className="text-sm text-slate-400">
            Last 24 hours: {oracle.last24h.questions} questions, {oracle.last24h.inputTokens.toLocaleString()} tokens
            in, {oracle.last24h.outputTokens.toLocaleString()} out. All time: {oracle.allTime.questions} questions,{' '}
            {oracle.allTime.inputTokens.toLocaleString()} in, {oracle.allTime.outputTokens.toLocaleString()} out.
          </p>
          {oracle.topAskers24h.length > 0 && (
            <p className="text-sm text-slate-400">
              Most active today: {oracle.topAskers24h.map((a) => `${a.name} (${a.questions})`).join(', ')}
            </p>
          )}
        </div>
      )}
    </Section>
  )
}
