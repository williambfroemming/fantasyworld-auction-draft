import { NextResponse } from 'next/server'
import { getSql } from '@/server/sql'

/**
 * The names on the sign-in screen. PUBLIC — see src/lib/gate.ts.
 *
 * Exactly what the seat picker needs and nothing more: id, display name, colour and
 * whether the seat has a PIN yet. Never the hash, never the commissioner flag. Not
 * /api/state, which is polled constantly and carries the whole draft.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  const rows = await getSql()`
    SELECT id, display_name, color, (pin_hash IS NOT NULL) AS has_pin
    FROM managers
    ORDER BY draft_slot`
  return NextResponse.json(
    {
      seats: rows.map((r) => ({
        id: r.id as number,
        displayName: r.display_name as string,
        color: r.color as string,
        hasPin: r.has_pin as boolean,
      })),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
