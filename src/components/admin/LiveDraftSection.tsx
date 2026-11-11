'use client'

import type { Board } from '@/hooks/useDraft'
import type { DraftState } from '@/server/draft-service'
import { Btn, Section, type Act } from './ui'

/**
 * The draft-night controls, formerly the ⚙ Commish drawer in the Draft Room.
 *
 * First on the page on purpose: when something goes wrong mid-lot the
 * commissioner is being shouted at by nine people, and these are the buttons
 * they came for. Account menu → Admin panel lands here.
 */
export function LiveDraftSection({
  state,
  board,
  act,
  busy,
}: {
  state: DraftState
  board: Board | null
  act: Act
  busy: boolean
}) {
  const status = state.draft.status
  const paused = status === 'paused'
  const lastPick = [...(board?.rosters ?? [])].sort((a, b) => b.pickNo - a.pickNo)[0]
  const onClock = state.managers.find((m) => m.id === state.onTheClock?.managerId)

  return (
    <Section
      id="live"
      title="Live draft"
      note="Pause blocks nominations and sales. Nothing expires while paused — the player on the block stays up."
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-400">
        <span>
          Status <span className="font-semibold text-slate-100">{status}</span>
        </span>
        {state.lot && (
          <span>
            On the block <span className="font-semibold text-slate-100">{state.lot.playerName}</span>
          </span>
        )}
        {onClock && !state.lot && (status === 'live' || paused) && (
          <span>
            On the clock <span className="font-semibold text-slate-100">{onClock.displayName}</span>
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {status === 'setup' && (
          <Btn onClick={() => act({ action: 'setStatus', status: 'live' }, 'Draft is live.')} tone="go" disabled={busy}>
            ▶ Start draft
          </Btn>
        )}
        {(status === 'live' || paused) && (
          <Btn
            onClick={() => act({ action: paused ? 'resume' : 'pause' }, paused ? 'Resumed.' : 'Paused.')}
            disabled={busy}
            tone={paused ? 'go' : 'warn'}
          >
            {paused ? '▶ Resume' : '❚❚ Pause'}
          </Btn>
        )}
        {status === 'live' && (
          <Btn
            onClick={() =>
              act({ action: 'setStatus', status: 'setup' }, 'Back to setup.', 'Take the draft back to setup?')
            }
            disabled={busy}
            tone="ghost"
          >
            Back to setup
          </Btn>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-rule pt-4">
        <Btn
          onClick={() =>
            act(
              { action: 'undoLastPick' },
              'Pick undone.',
              lastPick
                ? `Undo pick #${lastPick.pickNo} (${lastPick.name}, $${lastPick.price})? The player returns to the pool and the money is refunded.`
                : undefined,
            )
          }
          disabled={busy || !lastPick}
          tone="danger"
        >
          Undo last pick
        </Btn>
        <Btn
          onClick={() => act({ action: 'voidLot' }, 'Lot cancelled.', 'Take the current player back off the block?')}
          disabled={busy || !state.lot}
          tone="danger"
        >
          Cancel current lot
        </Btn>
        <Btn onClick={() => act({ action: 'skipNominator' }, 'Skipped.')} disabled={busy || !!state.lot}>
          Skip nominator
        </Btn>
      </div>
      {lastPick && (
        <p className="mt-2 text-xs text-slate-500">
          Last pick: #{lastPick.pickNo} {lastPick.name} — ${lastPick.price}. Any other pick can be fixed under
          Picks below.
        </p>
      )}
    </Section>
  )
}
