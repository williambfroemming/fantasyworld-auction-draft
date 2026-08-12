import { cookies } from 'next/headers'
import { SESSION_COOKIE, sessionSecret, verifySession } from '@/lib/auth'

/** The signed-in manager id, or null. Never trusts a client-supplied id. */
export async function currentManagerId(): Promise<number | null> {
  const jar = await cookies()
  return verifySession(jar.get(SESSION_COOKIE)?.value, sessionSecret())
}

export async function requireManagerId(): Promise<number> {
  const id = await currentManagerId()
  if (id === null) throw new UnauthorizedError()
  return id
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Not signed in')
    this.name = 'UnauthorizedError'
  }
}
