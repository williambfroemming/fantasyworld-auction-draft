'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DraftState } from '@/server/draft-service'
import type { TradeSummary } from '@/server/trade-service'

export interface BoardPlayer {
  id: string
  name: string
  team: string | null
  position: string
  /** TODAY'S pool rank. Contrast `RosterPick.rank`, which is frozen. */
  rank: number | null
  posRank: number | null
  byeWeek: number | null
}

export interface RosterPick {
  id: number
  pickNo: number
  /** Current owner. A trade moves this; `price` stays charged to the drafter. */
  managerId: number
  nominatorId: number
  price: number
  slotOverride: string | null
  name: string
  team: string | null
  position: string
  /**
   * Pool rank AT AWARD TIME — a snapshot, not a live lookup. Same field name as
   * `BoardPlayer.rank` but different provenance: that one is today's pool, this
   * one was frozen the night the player was bought. Null for picks made before
   * the snapshot column existed; treat null as "not scored", never as rank 0.
   */
  rank: number | null
  posRank: number | null
  byeWeek: number | null
}

export interface Board {
  pool: BoardPlayer[]
  rosters: RosterPick[]
  trades: TradeSummary[]
}

const POLL_MS = 400

/**
 * Live draft state.
 *
 * Polls a tiny endpoint that 204s when nothing has changed, and refetches the
 * heavy board only when the version moves.
 *
 * There is no countdown to keep smooth any more, so there is no clock sync
 * either — nothing on screen depends on the client's clock, which removes the
 * whole class of "someone's laptop is eight minutes fast" problems. 400ms of
 * staleness cannot cost anyone a player: the price is agreed out loud in the
 * room and then typed in once.
 */
export function useDraft() {
  const [state, setState] = useState<DraftState | null>(null)
  const [board, setBoard] = useState<Board | null>(null)
  const [connected, setConnected] = useState(true)

  const versionRef = useRef<string | null>(null)
  const boardVersionRef = useRef<string | null>(null)
  const inFlight = useRef(false)

  const poll = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const url = versionRef.current
        ? `/api/state?v=${encodeURIComponent(versionRef.current)}`
        : '/api/state'
      const res = await fetch(url, { cache: 'no-store' })
      setConnected(true)

      if (res.status === 204) return // nothing changed

      const next = (await res.json()) as DraftState
      versionRef.current = next.version
      setState(next)
    } catch {
      // Offline, sleeping phone, flaky wifi. Keep the last known state on screen
      // and keep trying — the next successful poll resyncs everything.
      setConnected(false)
    } finally {
      inFlight.current = false
    }
  }, [])

  // Poll loop. setTimeout rather than setInterval so a slow response can't
  // stack up a queue of overlapping requests.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      await poll()
      if (alive) timer = setTimeout(tick, POLL_MS)
    }
    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [poll])

  // Refetch the heavy board only when the version actually moves.
  useEffect(() => {
    if (!state || state.version === boardVersionRef.current) return
    boardVersionRef.current = state.version
    fetch('/api/board', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setBoard)
      .catch(() => {})
  }, [state])

  /** Force an immediate refresh — used right after your own action lands. */
  const refresh = useCallback(async () => {
    versionRef.current = null
    await poll()
  }, [poll])

  return { state, board, connected, refresh }
}
