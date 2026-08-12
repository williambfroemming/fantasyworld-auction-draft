/**
 * The polling fingerprint.
 *
 * `/api/state` returns 204 when this string is unchanged, which is what keeps
 * 10 clients polling 2.5x/second cheap.
 *
 * It is a composed fingerprint rather than a single incrementing counter on
 * purpose: a global counter would have to be bumped by the bid path, and the bid
 * is deliberately a single atomic UPDATE against `lots` (Neon's HTTP driver has
 * no interactive transactions). Composing the fingerprint from values that each
 * mutation already touches means there is no bump discipline to forget.
 *
 *   draft.rev    -> settings, pause/resume, order changes
 *   lot version  -> bumped atomically by the bid UPDATE
 *   pick count   -> changes when a lot settles
 */
export interface VersionParts {
  rev: number
  lotId: number | null
  lotVersion: number | null
  pickCount: number
  draftStatus: string
}

export function fingerprint(p: VersionParts): string {
  return [p.rev, p.lotId ?? 0, p.lotVersion ?? 0, p.pickCount, p.draftStatus].join(':')
}
