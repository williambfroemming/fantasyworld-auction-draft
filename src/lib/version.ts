/**
 * The polling fingerprint.
 *
 * `/api/state` returns 204 when this string is unchanged, which is what keeps
 * 10 clients polling 2.5x/second cheap.
 *
 * It is a composed fingerprint rather than a single incrementing counter on
 * purpose: every mutation is a single atomic statement (Neon's HTTP driver has
 * no interactive transactions), so there is no transaction in which to bump a
 * counter as well. Composing the fingerprint from values that each mutation
 * already touches means there is no bump discipline to forget.
 *
 *   season      -> a new year is started
 *   draft.rev   -> settings, pause/resume, order changes, trades
 *   lot id      -> a new player goes on the block
 *   pick count  -> a lot is awarded or undone (current season only)
 *
 * A trade moves `picks.manager_id` without changing the pick *count*, so the
 * trade statement bumps `draft.rev` in the same statement. Miss that and every
 * client keeps 204ing on a board that has quietly changed owners.
 *
 * `season` leads because rolling over to a new year resets the pick count to 0
 * and the status to 'setup' — values a client may well have seen before. Two
 * different drafts must never produce the same fingerprint.
 */
export interface VersionParts {
  season: number
  rev: number
  lotId: number | null
  pickCount: number
  draftStatus: string
}

export function fingerprint(p: VersionParts): string {
  return [p.season, p.rev, p.lotId ?? 0, p.pickCount, p.draftStatus].join(':')
}
