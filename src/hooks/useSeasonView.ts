'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import type { ArchiveSeason, SeasonSummary } from '@/server/archive-service'

/**
 * "Which season am I looking at?" — shared by /board and /stats.
 *
 * Extracted from /board rather than copied, so the two screens cannot drift
 * apart on the fiddly parts:
 *
 *  - The season list is fetched once, on mount.
 *  - An archived season is fetched **once per selection and never polled**. A
 *    finished draft does not change, and polling it would put a heavy payload
 *    on a timer for no reason.
 *  - Results carry the season they belong to, so a slow response for 2026
 *    arriving after the user has already switched back to live is simply
 *    ignored rather than rendered. That is what `loaded.season === viewing`
 *    below is for — it also means there is no "clear the old one" setState in
 *    an effect body, which Next 16's lint rejects outright.
 *
 * ## The selection lives in the URL, not in `useState`
 *
 * It used to be component state, and `/history/drafts` has always linked to
 * `/stats?season=2024` and `/board?season=2024` — links that silently landed
 * on the live season, because nothing read the parameter. Deriving `viewing`
 * from the query string fixes those, and makes a year linkable, refreshable
 * and reachable with the back button, which is what people expect of something
 * that reads like a page.
 *
 * ⚠️ `useSearchParams` opts the tree into client-side rendering up to the
 * nearest `<Suspense>` boundary, and Next 16 fails the **build** if there
 * isn't one. It will not fail in `next dev`, where routes render on demand —
 * so `npm run build` is the only thing that catches a missing boundary.
 */
export interface SeasonView {
  seasons: SeasonSummary[]
  /** Past seasons only — what the picker draws after the live option. */
  past: SeasonSummary[]
  /** null = the season being drafted now. */
  viewing: number | null
  setViewing: (season: number | null) => void
  isArchive: boolean
  /** Non-null only when the loaded payload matches the current selection. */
  archive: ArchiveSeason | null
  archiveError: string | null
}

/** `?season=2024` → 2024. Anything else, including junk, reads as "live". */
function parseSeason(raw: string | null): number | null {
  if (raw === null) return null
  return /^\d{4}$/.test(raw) ? Number(raw) : null
}

export function useSeasonView(): SeasonView {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [seasons, setSeasons] = useState<SeasonSummary[]>([])
  const [loaded, setLoaded] = useState<ArchiveSeason | null>(null)
  const [failed, setFailed] = useState<{ season: number; message: string } | null>(null)

  const viewing = parseSeason(searchParams.get('season'))

  const setViewing = useCallback(
    (season: number | null) => {
      const next = new URLSearchParams(searchParams.toString())
      if (season === null) next.delete('season')
      else next.set('season', String(season))
      const query = next.toString()
      // `replace`, not `push`: flicking through years is browsing one page, not
      // a trail of them, and `push` would make Back mean "previous year" for
      // however many you looked at before it meant "leave".
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [router, pathname, searchParams],
  )

  useEffect(() => {
    fetch('/api/archive', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setSeasons(d.seasons ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (viewing === null) return
    let alive = true
    fetch(`/api/archive?season=${viewing}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? 'Could not load that season')
        return r.json()
      })
      .then((d) => alive && setLoaded(d))
      .catch((e) => alive && setFailed({ season: viewing, message: e.message }))
    return () => {
      alive = false
    }
  }, [viewing])

  return {
    seasons,
    past: seasons.filter((s) => !s.isCurrent),
    viewing,
    setViewing,
    isArchive: viewing !== null,
    archive: loaded && loaded.season === viewing ? loaded : null,
    archiveError: failed && failed.season === viewing ? failed.message : null,
  }
}
