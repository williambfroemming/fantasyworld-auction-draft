'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LotPanel } from '@/components/LotPanel'
import { PlayerPool } from '@/components/PlayerPool'
import { SidePanel } from '@/components/SidePanel'
import { CommishDrawer } from '@/components/CommishDrawer'
import { useDraft } from '@/hooks/useDraft'
import { sounds, unlockAudio } from '@/lib/sounds'
import type { BoardPlayer } from '@/hooks/useDraft'

export default function DraftPage() {
  const router = useRouter()
  const { state, board, clock, connected, refresh } = useDraft()
  const [me, setMe] = useState<number | null>(null)
  const [checked, setChecked] = useState(false)

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

  async function placeBid(amount: number): Promise<string | null> {
    const res = await fetch('/api/bid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lotId: state!.lot!.id, amount }),
    })
    const data = await res.json()
    await refresh()
    return data.ok ? null : (data.reason ?? 'Bid rejected')
  }

  async function nominate(player: BoardPlayer, openingBid: number): Promise<string | null> {
    const res = await fetch('/api/nominate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId: player.id, openingBid }),
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

  return (
    <main
      className="min-h-dvh bg-slate-950 text-slate-100"
      onClickCapture={unlockAudio}
    >
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 px-4 py-3">
        <h1 className="text-lg font-bold tracking-tight">Auction Draft</h1>

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
                style={{ backgroundColor: `${myManager.color}33`, color: myManager.color }}
              >
                {myManager.displayName}
              </span>
            </>
          )}
        </div>
      </header>

      {myTurn && (
        <div className="bg-emerald-600/20 px-4 py-2 text-center text-sm font-semibold text-emerald-300">
          You&apos;re on the clock — nominate a player.
        </div>
      )}

      {/* Body: pool | lot | rosters */}
      <div className="grid gap-4 p-4 lg:grid-cols-[20rem_1fr_24rem]">
        <div className="order-2 h-[32rem] lg:order-1 lg:h-[calc(100dvh-9rem)]">
          <PlayerPool
            pool={board?.pool ?? []}
            canNominate={myTurn && state.draft.status === 'live'}
            onNominate={nominate}
          />
        </div>

        <div className="order-1 lg:order-2">
          <LotPanel state={state} clock={clock} me={me} onBid={placeBid} />

          {/* Recent picks ticker */}
          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {state.recentPicks.map((p) => {
              const m = state.managers.find((x) => x.id === p.managerId)
              return (
                <div
                  key={p.pickNo}
                  className="shrink-0 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2"
                >
                  <div className="text-xs text-slate-500">
                    #{p.pickNo} · <span style={{ color: m?.color }}>{m?.displayName}</span>
                  </div>
                  <div className="text-sm font-medium">
                    {p.playerName} <span className="text-emerald-400">${p.price}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="order-3 h-[32rem] lg:h-[calc(100dvh-9rem)]">
          <SidePanel state={state} board={board} me={me} />
        </div>
      </div>

      {myManager?.isCommish && (
        <CommishDrawer state={state} board={board} onDone={refresh} />
      )}
    </main>
  )
}
