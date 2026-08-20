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
  /**
   * Availability as of the last `npm run news:refresh` (docs/BACKLOG.md §1).
   *
   * **Null means unknown, not healthy.** A CSV-seeded pool that has never been
   * refreshed has null on every row, and painting those as fit would be a
   * confident wrong answer about the exact thing people are asking.
   */
  injury: PlayerInjuryView | null
}

export interface PlayerInjuryView {
  status: string
  bodyPart: string | null
  notes: string | null
  practice: string | null
  /** ISO timestamp of the refresh, so the UI can say "as of" rather than imply live. */
  updatedAt: string | null
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

/** Draft-night cadence. Ten clients at this rate is ~25 req/s — trivial. */
const POLL_MS = 400

/**
 * Cadence once the draft is finished.
 *
 * A completed draft changes only when a commissioner undoes something, which is
 * rare and never urgent, so 400ms buys nothing and costs a great deal. It does
 * NOT stop entirely: `undoPick` flips `status` back to 'live', and a client that
 * had stopped polling would sit on a finished board forever with no way back.
 */
const DONE_POLL_MS = 30_000

/**
 * How often a hidden tab wakes up to check whether it is visible again.
 *
 * This costs no network — it re-checks `document.hidden` and goes back to sleep.
 * The `visibilitychange` listener is what actually resumes polling promptly; this
 * is the belt to its braces, so a missed event self-heals instead of leaving the
 * tab dark until reload.
 */
const HIDDEN_RECHECK_MS = 5_000

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
 *
 * ## Why the loop backs off, and why that is not a caching change
 *
 * `/api/state` is deliberately uncached and always will be (see the route). But
 * *uncached* is not the same as *polled forever at draft-night speed*. Every
 * poll runs five queries against Neon even on the 204 path, because the version
 * is computed from the state rather than stored — so one browser tab left open
 * costs ~216,000 requests and ~1.08M queries a day whether or not anybody is
 * looking at it. Four days after the 2026 draft that had consumed the database's
 * entire data-transfer quota, which is a self-inflicted outage on the one system
 * the league cannot run the draft without.
 *
 * So the loop is fast when it matters and quiet when it does not:
 *   - **hidden tab** → no requests at all, resuming immediately on focus
 *   - **finished draft** → every 30s, still live enough to notice an undo
 *   - **anything else** → 400ms, exactly as before
 *
 * Nothing here weakens draft night: during setup, live and paused, with the tab
 * in front of someone, the cadence is unchanged.
 */
export function useDraft() {
  const [state, setState] = useState<DraftState | null>(null)
  const [board, setBoard] = useState<Board | null>(null)
  const [connected, setConnected] = useState(true)

  const versionRef = useRef<string | null>(null)
  const boardVersionRef = useRef<string | null>(null)
  const inFlight = useRef(false)
  /**
   * Latest status, held in a ref rather than read from `state`.
   *
   * The poll loop must not re-subscribe every time state changes — that would
   * tear down and restart the timer on every pick — so the loop reads the
   * cadence from here instead of taking `state` as a dependency.
   */
  const statusRef = useRef<DraftState['draft']['status'] | null>(null)
  /**
   * Lets `refresh()` restart the loop at the cadence the *new* status deserves.
   * Undoing a pick on a finished draft flips it back to 'live', and without this
   * the client that did it would keep the 30s timer it was already sitting on.
   */
  const rescheduleRef = useRef<(() => void) | null>(null)

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
      statusRef.current = next.draft.status
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
    let timer: ReturnType<typeof setTimeout> | undefined
    // Guards against two timer chains existing at once. Without it, a
    // visibilitychange arriving while a poll is in flight starts a second chain
    // that the first one's `setTimeout` then orphans — and the tab quietly polls
    // at double rate for the rest of its life.
    let ticking = false

    const schedule = (ms: number) => {
      clearTimeout(timer)
      if (alive) timer = setTimeout(tick, ms)
    }

    const tick = async () => {
      if (!alive || ticking) return
      ticking = true
      try {
        // A hidden tab makes no request at all. It still wakes periodically so a
        // missed visibilitychange event cannot leave it dark until reload.
        if (typeof document !== 'undefined' && document.hidden) {
          schedule(HIDDEN_RECHECK_MS)
          return
        }
        await poll()
        schedule(statusRef.current === 'done' ? DONE_POLL_MS : POLL_MS)
      } finally {
        ticking = false
      }
    }

    // Coming back to the tab should feel instant, not "up to 30 seconds".
    const onVisible = () => {
      if (document.hidden) return
      tick()
    }

    rescheduleRef.current = () => schedule(statusRef.current === 'done' ? DONE_POLL_MS : POLL_MS)

    tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      rescheduleRef.current = null
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
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
    // The action may have restarted a finished draft, so re-arm at the cadence
    // the status we just read calls for rather than the one we were sitting on.
    rescheduleRef.current?.()
  }, [poll])

  return { state, board, connected, refresh }
}
