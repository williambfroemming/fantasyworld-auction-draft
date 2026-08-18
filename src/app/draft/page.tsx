'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { LotPanel, PositionBadge } from '@/components/LotPanel'
import { NominationOrder } from '@/components/NominationOrder'
import { PlayerPool } from '@/components/PlayerPool'
import { SidePanel } from '@/components/SidePanel'
import { CommishDrawer } from '@/components/CommishDrawer'
import { useDraft } from '@/hooks/useDraft'
import { useQueue } from '@/hooks/useQueue'
import { sounds, unlockAudio } from '@/lib/sounds'
import type { BoardPlayer } from '@/hooks/useDraft'
import { managerTint } from '@/lib/colors'

export default function DraftPage() {
  const router = useRouter()
  const { state, board, connected, refresh } = useDraft()
  const [me, setMe] = useState<number | null>(null)
  const [checked, setChecked] = useState(false)
  // Private, off the shared poll, refetched when the board moves so drafted
  // targets get marked. See docs/BACKLOG.md §4.
  const {
    queue,
    toggle: toggleQueue,
    prune: pruneQueue,
    reorder: reorderQueue,
  } = useQueue(state?.version, me !== null)

  useEffect(() => {
    fetch('/api/session')
      .then((r) => r.json())
      .then((d) => {
        setMe(d.managerId)
        setChecked(true)
        if (!d.managerId) router.replace('/')
      })
      .catch(() => setChecked(true))
  }, [router])

  // Alert when it becomes your turn — people wander off between lots.
  const wasMyTurn = useRef(false)
  useEffect(() => {
    const mine = state?.onTheClock?.managerId === me && !state?.lot
    if (mine && !wasMyTurn.current) sounds.yourTurn()
    wasMyTurn.current = !!mine
  }, [state, me])

  async function award(winnerId: number, price: number): Promise<string | null> {
    const res = await fetch('/api/award', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lotId: state!.lot!.id, winnerId, price }),
    })
    const data = await res.json()
    await refresh()
    return data.ok ? null : (data.reason ?? 'Could not record that sale')
  }

  async function nominate(player: BoardPlayer): Promise<string | null> {
    const res = await fetch('/api/nominate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: player.id }),
    })
    const data = await res.json()
    await refresh()
    return data.ok ? null : (data.reason ?? 'Nomination rejected')
  }

  if (!checked || !state) {
    return (
      <main className="grid min-h-dvh place-items-center bg-slate-950 text-slate-400">
        Loading draft…
      </main>
    )
  }

  const myManager = state.managers.find((m) => m.id === me)
  const myTurn = state.onTheClock?.managerId === me && !state.lot
  const onClock = state.managers.find((m) => m.id === state.onTheClock?.managerId)

  // Always say WHY nominating isn't available. A dead button with no
  // explanation is the single most confusing thing that can happen mid-draft.
  const nominateBlockedBecause = myTurn
    ? null
    : state.draft.status === 'setup'
      ? 'The draft has not been started yet.' +
        (myManager?.isCommish ? ' Open ⚙ Commish → Start draft.' : ' Waiting on the commissioner.')
      : state.draft.status === 'paused'
        ? 'The draft is paused.'
        : state.draft.status === 'done'
          ? 'The draft is complete.'
          : state.lot
            ? `${state.lot.playerName} is on the block.`
            : `It's ${onClock?.displayName ?? 'someone else'}'s turn to nominate.`

  return (
    <main
      className="min-h-dvh bg-slate-950 text-slate-100"
      onClickCapture={unlockAudio}
    >
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 px-4 py-3">
        <h1 className="text-lg font-bold tracking-tight">Auction Draft</h1>
        <Link
          href="/board"
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
        >
          League board →
        </Link>
        <Link
          href="/trades"
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
        >
          Trades →
        </Link>
        <Link
          href="/stats"
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
        >
          Stats →
        </Link>

        {state.draft.status === 'paused' && (
          <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs font-semibold text-amber-300">
            PAUSED
          </span>
        )}
        {state.draft.status === 'setup' && (
          <span className="rounded-full bg-slate-700/60 px-3 py-1 text-xs font-semibold text-slate-300">
            NOT STARTED
          </span>
        )}
        {!connected && (
          <span className="rounded-full bg-rose-500/20 px-3 py-1 text-xs font-semibold text-rose-300">
            Reconnecting…
          </span>
        )}

        <div className="ml-auto flex items-center gap-3 text-sm">
          {myManager && (
            <>
              <span className="hidden text-slate-500 sm:inline">
                ${myManager.budget} · max ${myManager.maxBid} · {myManager.rostered}/
                {state.draft.rosterSize}
              </span>
              <span
                className="rounded-full px-3 py-1 text-xs font-semibold"
                style={{ backgroundColor: managerTint(myManager.color, 20), color: myManager.color }}
              >
                {myManager.displayName}
              </span>
              {/* Switching seats matters more than it sounds: laptops get passed
                  around, and during testing one person plays several managers. */}
              <button
                onClick={async () => {
                  await fetch('/api/session', { method: 'DELETE' })
                  router.push('/')
                }}
                className="text-xs text-slate-500 underline-offset-2 hover:text-slate-300 hover:underline"
              >
                switch
              </button>
            </>
          )}
        </div>
      </header>

      {/* Your own turn still gets a full-width call-out — it is the one thing
          somebody must not miss. The order strip below carries everyone else. */}
      {state.draft.status === 'live' && !state.lot && myTurn && (
        <div className="bg-emerald-600/20 px-4 py-2 text-center text-sm font-semibold text-emerald-300">
          You&apos;re on the clock — pick a player from the list on the left to put up.
        </div>
      )}

      {/* Who's up, and who's coming. Above the lot because it is about what
          happens next; the recent-picks ticker below is about what already did. */}
      {state.draft.status !== 'setup' && <NominationOrder state={state} me={me} />}
      {state.draft.status === 'setup' && (
        <div className="bg-amber-500/15 px-4 py-2 text-center text-sm font-semibold text-amber-300">
          Draft not started.{' '}
          {myManager?.isCommish ? 'Open ⚙ Commish → Start draft.' : 'Waiting on the commissioner.'}
        </div>
      )}

      {/*
        Layout: three full-height columns. The centre column stacks the lot, the
        recent-picks ticker, and then the league board, which expands to eat all
        remaining vertical space — that space was previously dead, and the board
        is the thing everyone actually stares at.
      */}
      <div className="grid gap-3 p-3 lg:h-[calc(100dvh-6.5rem)] lg:grid-cols-[19rem_minmax(0,1fr)_19rem]">
        <div className="order-2 h-[28rem] min-h-0 lg:order-1 lg:h-auto">
          <PlayerPool
            pool={board?.pool ?? []}
            canNominate={myTurn && state.draft.status === 'live'}
            disabledReason={nominateBlockedBecause}
            onNominate={nominate}
            queue={queue}
            onToggleQueue={toggleQueue}
            onPruneQueue={pruneQueue}
            onReorderQueue={reorderQueue}
          />
        </div>

        <div className="order-1 flex min-h-0 flex-col gap-3 lg:order-2">
          <div className="min-h-[24rem] flex-1">
            <LotPanel state={state} me={me} onAward={award} />
          </div>

          {/* What just went, and for how much. Kept because "what did Puka
              actually go for" is asked constantly, but tightened: the position
              badge and the price do the work, and the row scans left-to-right
              as newest-first. */}
          {state.recentPicks.length > 0 && (
            <div className="flex shrink-0 items-center gap-2 overflow-x-auto pb-1">
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                Just sold
              </span>
              {state.recentPicks.map((p) => {
                const m = state.managers.find((x) => x.id === p.managerId)
                return (
                  <div
                    key={p.pickNo}
                    className="flex shrink-0 items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5"
                  >
                    <PositionBadge position={p.playerPosition} />
                    <span className="text-sm font-medium">{p.playerName}</span>
                    <span className="text-sm font-bold text-emerald-400">${p.price}</span>
                    <span className="flex items-center gap-1 text-[11px] text-slate-500">
                      <span
                        className="h-3 w-1 rounded-full"
                        style={{ backgroundColor: m?.color }}
                      />
                      {m?.displayName}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="order-3 h-[26rem] min-h-0 lg:h-auto">
          <SidePanel state={state} board={board} me={me} />
        </div>
      </div>

      {myManager?.isCommish && (
        <CommishDrawer state={state} board={board} onDone={refresh} />
      )}
    </main>
  )
}
