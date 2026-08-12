/** Flip the draft to live. Also usable from the commissioner drawer. */
import { neon } from '@neondatabase/serverless'
const sql = neon(process.env.DATABASE_URL!)
sql`UPDATE draft SET status='live', rev = rev + 1 WHERE id=1`
  .then(() => sql`SELECT status FROM draft WHERE id=1`)
  .then(([d]) => console.log('draft status →', d.status))
