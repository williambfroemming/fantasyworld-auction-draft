import { NextResponse } from 'next/server'
import { getArchivedSeason, listSeasons } from '@/server/archive-service'

/**
 * Past seasons, read-only.
 *
 *   GET /api/archive              -> { seasons: [...] }   the year picker
 *   GET /api/archive?season=2026  -> one finished board
 *
 * Deliberately its own route rather than a parameter on /api/board. That route
 * is on the draft-night hot path, refetched by ten clients every time the
 * version moves, and it carries the 500-row live pool — none of which an
 * archive read wants. Keeping them apart means browsing 2026 during the 2027
 * draft cannot slow the draft down.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get('season')

  if (requested === null) {
    return NextResponse.json(
      { seasons: await listSeasons() },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  if (!/^\d{4}$/.test(requested)) {
    return NextResponse.json({ error: 'season must be a four-digit year' }, { status: 400 })
  }

  const archived = await getArchivedSeason(Number(requested))
  if (!archived) {
    return NextResponse.json({ error: `No draft on record for ${requested}` }, { status: 404 })
  }

  return NextResponse.json(archived, { headers: { 'Cache-Control': 'no-store' } })
}
