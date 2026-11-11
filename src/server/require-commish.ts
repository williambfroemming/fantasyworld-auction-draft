import { currentManagerId } from './session'
import { getSql } from './sql'

/**
 * Who is asking, and are they the commissioner?
 *
 * Commissioner status is read from the database against the signed session id —
 * never taken from the request, and never from anything a client could have
 * cached. The account menu and the /admin page use `isCommish` only to decide
 * what to *draw*; every route that acts re-asks here.
 *
 *   { status: 401 }  signed out
 *   { status: 403 }  signed in, not the commissioner
 */
export type CommishCheck = { ok: true; id: number } | { ok: false; status: 401 | 403; reason: string }

export async function checkCommish(): Promise<CommishCheck> {
  const id = await currentManagerId()
  if (id === null) return { ok: false, status: 401, reason: 'Not signed in' }
  const [me] = await getSql()`SELECT is_commish FROM managers WHERE id = ${id}`
  if (!me?.is_commish) return { ok: false, status: 403, reason: 'Commissioner only' }
  return { ok: true, id }
}
