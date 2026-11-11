import { notFound } from 'next/navigation'
import { AdminPanel } from '@/components/admin/AdminPanel'
import { checkCommish } from '@/server/require-commish'

/**
 * The commissioner's admin panel.
 *
 * Checked on the server, so a member who types /admin gets a 404 and never so
 * much as the page's code paths. Signed-out visitors never reach this at all —
 * src/proxy.ts sends them to /join first. Neither check is the security
 * boundary: every action the panel sends is re-checked by `/api/commish`,
 * `/api/admin` and `/api/oracle-admin` against the signed session.
 *
 * Dynamic because the answer depends on who is asking; a cached render would
 * hand one visitor's verdict to the next.
 */
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Admin' }

export default async function AdminPage() {
  const who = await checkCommish()
  if (!who.ok) notFound()
  return <AdminPanel me={who.id} />
}
