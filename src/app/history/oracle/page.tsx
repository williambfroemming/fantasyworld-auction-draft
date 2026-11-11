import Link from 'next/link'
import { OracleBar } from '@/components/OracleBar'
import { SiteNav } from '@/components/SiteNav'
import { HeaderControls } from '@/components/HeaderControls'
import { currentManagerId } from '@/server/session'
import { oracleEnabled } from '@/server/settings-service'

/**
 * Ask the Oracle (docs/ANALYTICS_ROADMAP.md §A).
 *
 * Reads the session cookie, so it is dynamic by nature: signed-out visitors get a link to
 * /join instead of the input, and the route behind it refuses them again regardless.
 * The page says plainly what the Oracle knows and what it does not, because a confident
 * answer about the NFL at large would be a made-up one.
 */
export const metadata = { title: 'Ask the Oracle — FantasyWorld' }

export default async function OraclePage() {
  const [managerId, enabled] = await Promise.all([currentManagerId(), oracleEnabled()])
  const signedIn = managerId !== null

  return (
    <main id="main" className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav section="history" current="/history/oracle" />
        <h1 className="font-display text-lg font-bold uppercase tracking-[0.08em]">
          Ask the Oracle
        </h1>
        <div className="ml-auto">
          <HeaderControls />
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6">
        <p className="mb-6 text-base leading-relaxed text-slate-300">
          Ask a question about this league in plain English and the Oracle works it out from the
          record: games from 2020, standings from 2011, auctions from 2021, champions from 2006.
          It knows nothing about the NFL at large, and player scores count only the weeks that
          player was on a roster in this league. The SQL and the rows are shown under every
          answer so you can check it.
        </p>

        {!enabled ? (
          <p className="text-base text-amber-300">
            The Oracle is switched off right now. Ask the commissioner if you need it back.
          </p>
        ) : signedIn ? (
          <OracleBar />
        ) : (
          <p className="text-base text-slate-200">
            <Link href="/join" className="underline underline-offset-2">
              Sign in to ask the Oracle
            </Link>
            . Every question costs real money, so it is for league members only.
          </p>
        )}
      </div>
    </main>
  )
}
