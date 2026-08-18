'use client'

import { useCallback, useEffect, useState } from 'react'
import type { QueuedPlayer } from '@/server/queue-service'

/**
 * The signed-in manager's private player queue (docs/BACKLOG.md §4).
 *
 * Deliberately **not** part of `useDraft`'s 400ms poll. The queue is private, it
 * changes only when you change it, and folding it into the shared poll would put
 * a per-manager payload on a league-wide endpoint — the one thing §4 says must
 * never happen.
 *
 * It is refetched when `boardVersion` moves, which is how drafted targets get
 * marked: someone else buying a player you starred is the only way this data goes
 * stale without you touching it.
 */
export function useQueue(boardVersion: string | null | undefined, signedIn: boolean) {
  const [queue, setQueue] = useState<QueuedPlayer[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!signedIn) return
    let alive = true
    fetch('/api/queue', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setQueue(d.queue ?? []))
      // Offline. Keep the last known queue on screen — it is a shortlist, not
      // state anything depends on.
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [signedIn, boardVersion])

  const act = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true)
      try {
        const res = await fetch('/api/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (data.ok && data.queue) setQueue(data.queue)
        return data.ok ? null : (data.reason ?? 'Could not update your queue')
      } catch {
        return 'Could not reach the server'
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const toggle = useCallback(
    (playerId: string, queued: boolean) => act({ action: queued ? 'remove' : 'add', playerId }),
    [act],
  )
  const prune = useCallback(() => act({ action: 'prune' }), [act])

  /**
   * Move an entry, optimistically.
   *
   * The reorder is applied locally first and the server is told afterwards.
   * Waiting for the round trip would make a dragged row snap back to where it
   * started for ~200ms, which reads as the drag having failed and invites a
   * second drag on top of the first. The POST returns the authoritative queue
   * and `act` overwrites with it, so a rejected reorder still self-corrects.
   */
  const reorder = useCallback(
    (from: number, to: number) => {
      let next: QueuedPlayer[] = []
      setQueue((current) => {
        if (from === to || from < 0 || from >= current.length) return current
        const copy = [...current]
        const [moved] = copy.splice(from, 1)
        copy.splice(Math.max(0, Math.min(copy.length, to)), 0, moved)
        next = copy
        return copy
      })
      if (next.length === 0) return Promise.resolve(null)
      return act({ action: 'reorder', playerIds: next.map((q) => q.playerId) })
    },
    [act],
  )

  return { queue, toggle, prune, reorder, busy }
}
