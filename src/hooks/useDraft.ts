'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ClockSync } from '@/lib/clock'
import type { DraftState } from '@/server/draft-service'

export interface BoardPlayer {
  id: string
  name: string
  team: string | null
  position: string
  rank: number | null
  posRank: number | null
  tier: number | null
  byeWeek: number | null
}

export interface RosterPick {
  id: number
  pickNo: number
  managerId: number
  price: number
  slotOverride: string | null
  name: string
  team: string | null
  position: string
  byeWeek: number | null
}

export interface Board {
  pool: BoardPlayer[]
  rosters: RosterPick[]
}

const POLL_MS = 400

/**
 * Live draft state.
 *
 * Polls a tiny endpoint that 204s when nothing has changed, and refetches the
 * heavy board only when the version moves. The countdown is NOT polled — it is
 * rendered from `endsAt` against a skew-corrected server clock, so it ticks
 * smoothly at 60fps regardless of poll rate.
 *
 * Why polling is sufficient: any bid inside the final 10 seconds resets the
 * clock to 10, so seeing a bid up to 400ms late can never cost you a player.
 */
export function useDraft() {
  const [state, setState] = useState<DraftState | null>(null)
  const [board, setBoard] = useState<Board | null>(null)
  const [connected, setConnected] = useState(true)

  const clockRef = useRef(new ClockSync())
  const versionRef = useRef<string | null>(null)
  const boardVersionRef = useRef<string | null>(null)
  const inFlight = useRef(false)

  const poll = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    const sentAt = Date.now()
    try {
      const url = versionRef.current
        ? `/api/state?v=${encodeURIComponent(versionRef.current)}`
        : '/api/state'
      const res = await fetch(url, { cache: 'no-store' })
      setConnected(true)

      if (res.status === 204) return // nothing changed

      const next = (await res.json()) as DraftState
      clockRef.current.sample({ serverNow: next.serverNow, sentAt, receivedAt: Date.now() })
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

  return { state, board, clock: clockRef.current, connected, refresh }
}

/**
 * Re-render on an animation frame so the countdown is smooth.
 * Returns seconds remaining, or null when there's nothing on the clock.
 */
export function useCountdown(endsAt: string | null | undefined, clock: ClockSync, paused: boolean) {
  const [, force] = useState(0)

  useEffect(() => {
    if (!endsAt || paused) return
    let raf: number
    const loop = () => {
      force((n) => n + 1)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [endsAt, paused])

  if (!endsAt) return null
  return {
    seconds: clock.secondsUntil(endsAt),
    ms: clock.msUntil(endsAt),
    synced: clock.synced,
  }
}
