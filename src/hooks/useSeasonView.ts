'use client'

import { useEffect, useState } from 'react'
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
 */
export interface SeasonView {
  seasons: SeasonSummary[]
  /** Past seasons only — what the picker draws after the live tab. */
  past: SeasonSummary[]
  /** null = the season being drafted now. */
  viewing: number | null
  setViewing: (season: number | null) => void
  isArchive: boolean
  /** Non-null only when the loaded payload matches the current selection. */
  archive: ArchiveSeason | null
  archiveError: string | null
}

export function useSeasonView(): SeasonView {
  const [seasons, setSeasons] = useState<SeasonSummary[]>([])
  const [viewing, setViewing] = useState<number | null>(null)
  const [loaded, setLoaded] = useState<ArchiveSeason | null>(null)
  const [failed, setFailed] = useState<{ season: number; message: string } | null>(null)

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
