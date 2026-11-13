import { redirect } from 'next/navigation'
import { HeaderControls } from '@/components/HeaderControls'
import { SiteNav } from '@/components/SiteNav'
import { AccountPanel } from '@/components/AccountPanel'
import { currentManagerId } from '@/server/session'

/**
 * Your account: change your PIN, change your name, see which fantasy accounts are
 * linked to your seat. Reached from the account menu.
 *
 * Dynamic because it depends on who is asking. Signed-out visitors never get here —
 * src/proxy.ts sends them to /join — but the check is repeated so a stale cookie for a
 * deleted seat lands somewhere sensible. Every action is re-checked by /api/account.
 */
export const dynamic = 'force-dynamic'

export const metadata = { title: 'Your account' }

export default async function AccountPage() {
  if ((await currentManagerId()) === null) redirect('/join?next=/account')
  return (
    <main id="main" className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav current="/account" />
        <h1 className="font-display text-lg font-bold uppercase tracking-[0.08em]">Your account</h1>
        <div className="ml-auto">
          <HeaderControls />
        </div>
      </header>
      <div className="mx-auto max-w-md px-4 py-6">
        <AccountPanel />
      </div>
    </main>
  )
}
