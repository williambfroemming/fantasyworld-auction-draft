'use client'

import { useState } from 'react'
import type { DraftState } from '@/server/draft-service'
import { Btn, NumberField, Section, type Act } from './ui'

/**
 * Budget and roster size. Locked once the first player of this season is sold —
 * both feed max bid, and changing either mid-draft would rewrite every manager's
 * limit retroactively. The service enforces that; this only greys the boxes.
 *
 * There are no timer settings: the auction is called aloud in the room and the
 * nominator records the result. See docs/PROJECT_PLAN.md §3.
 */
export function RulesSection({
  state,
  locked,
  act,
  busy,
}: {
  state: DraftState
  locked: boolean
  act: Act
  busy: boolean
}) {
  const [budget, setBudget] = useState(String(state.draft.startingBudget))
  const [roster, setRoster] = useState(String(state.draft.rosterSize))
  const maxAtStart = Number(budget) - (Number(roster) - 1)

  return (
    <Section id="rules" title="Rules" note="Budget and roster size lock once the first player is sold.">
      <div className="grid gap-3 sm:grid-cols-2">
        <NumberField label="Budget per manager" value={budget} onChange={setBudget} disabled={locked} />
        <NumberField label="Roster spots" value={roster} onChange={setRoster} disabled={locked} />
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Opening max bid will be{' '}
        <span className="font-semibold text-emerald-400">${Number.isFinite(maxAtStart) ? maxAtStart : '—'}</span> —
        each empty roster spot keeps $1 in reserve.
      </p>
      <Btn
        tone="primary"
        className="mt-3"
        onClick={() =>
          act(
            { action: 'setLeagueSettings', startingBudget: Number(budget), rosterSize: Number(roster) },
            'Rules saved.',
          )
        }
        disabled={busy || locked}
      >
        Save rules
      </Btn>
    </Section>
  )
}
