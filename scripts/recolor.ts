/** Reassign manager colours from the palette in src/lib/colors.ts. */
import { neon } from '@neondatabase/serverless'
import '../src/db/neon-local'
import { colorForSeat, colorNameForSeat, textOn } from '../src/lib/colors'

async function main() {
  const sql = neon(process.env.DATABASE_URL!)
  const managers = await sql`SELECT id, display_name, draft_slot FROM managers ORDER BY draft_slot`
  for (const m of managers) {
    await sql`UPDATE managers SET color = ${colorForSeat(m.draft_slot)} WHERE id = ${m.id}`
  }
  await sql`UPDATE draft SET rev = rev + 1 WHERE id = 1`
  console.table(
    managers.map((m) => ({
      seat: m.draft_slot + 1,
      manager: m.display_name,
      colour: colorNameForSeat(m.draft_slot),
      hex: colorForSeat(m.draft_slot),
      'header text': textOn(colorForSeat(m.draft_slot)) === '#0f172a' ? 'dark' : 'white',
    })),
  )
}
main().catch((e) => { console.error(e); process.exit(1) })
