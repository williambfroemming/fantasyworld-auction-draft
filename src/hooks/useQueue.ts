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

  return { queue, toggle, prune, busy }
}
