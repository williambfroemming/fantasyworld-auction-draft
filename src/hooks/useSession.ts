'use client'

import { useEffect, useState } from 'react'

/**
 * Who the current visitor is, from the signed session cookie.
 *
 * Returns `undefined` while the answer is unknown and `null` once it is known to
 * be nobody, so a caller can tell "still asking" from "not signed in" — the
 * difference between those two is why this is not just `number | null`.
 *
 * Read-only and advisory. It exists so the nav can decide whether to *draw* the
 * commissioner's Setup link; every commissioner action re-reads `is_commish`
 * from the database against the session id, so nothing here is a trust
 * boundary.
 *
 * `/draft` and `/trades` keep their own inline version because theirs also
 * redirects an unsigned visitor to the join screen, which is a page-level
 * decision rather than something a shared hook should impose.
 */
export function useSession(): { managerId: number | null | undefined } {
  const [managerId, setManagerId] = useState<number | null | undefined>(undefined)

  useEffect(() => {
    let alive = true
    fetch('/api/session')
      .then((r) => r.json())
      .then((d: { managerId: number | null }) => {
        if (alive) setManagerId(d.managerId ?? null)
      })
      .catch(() => {
        // A failed session lookup means "we do not know", which for nav purposes
        // is the same as not being the commissioner.
        if (alive) setManagerId(null)
      })
    return () => {
      alive = false
    }
  }, [])

  return { managerId }
}
