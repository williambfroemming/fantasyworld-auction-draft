import { redirect } from 'next/navigation'
import { SiteNav, SECTIONS } from '@/components/SiteNav'
import { ThemeToggle } from '@/components/ThemeToggle'
import {
  AuctionNumbers,
  ChampionLead,
  ChampionRibbon,
  Contents,
  GazetteTeaser,
  StatusStrip,
  type IssueTeaser,
} from '@/components/landing/FrontPage'
import { issueArt } from '@/server/gazette-art'
import { landingDestination } from '@/lib/landing'
import { getLiveSeason } from '@/server/draft-service'
import {
  getChampionshipLineup,
  listAuctions,
  listHistorySeasons,
} from '@/server/history-service'
import { listIssues } from '@/server/gazette-service'
import { currentManagerId } from '@/server/session'

/**
 * The front door. See `docs/BACKLOG.md` §11.
 *
 * Until now this route was the seat picker, and it sent anyone already signed in
 * straight to `/draft`. That was right in the week before the auction and wrong
 * the moment it ended: a returning manager landed on a live-draft screen with
 * nobody on the clock and a pool nobody could nominate from, while `/history`,
 * `/stats`, the record book and the Gazette all existed with nothing pointing at
 * them. The seat picker now lives at `/join`.
 *
 * ## Dynamic on purpose
 *
 * Reading the session cookie opts this route out of the `revalidate = 3600` that
 * every page under `/history` carries, and that is the right trade rather than
 * an oversight. The caching caution in `AGENTS.md` is about `/api/state`, which
 * is polled every 400ms at five queries a poll — about 1.08M queries a day from
 * a single open tab. This is three cheap queries on an occasional visit. Caching
 * it would save nothing worth having and would cost the correct first paint.
 *
 * ## The draft-night path is the cheap one
 *
 * The session and the season status are read first and the redirect happens
 * before the history reads are issued, so a manager arriving mid-auction pays
 * for two queries and a 307 — strictly less than the page load, hydration and
 * `/api/session` round trip this replaced. `docs/BACKLOG.md` §11's hard rule is
 * that a landing page must never sit in front of draft night, and the ordering
 * here is how that is kept true rather than merely intended.
 */
export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'FantasyWorld',
}

export default async function FrontPage() {
  const [managerId, live] = await Promise.all([currentManagerId(), getLiveSeason()])

  // An uninitialised draft has no season to be complete or otherwise. Treat it
  // as "not live" so a fresh database renders the page rather than redirecting
  // into a draft that does not exist yet.
  const complete = live === null || (live.seats > 0 && live.unfilled === 0)
  const to = landingDestination({ complete, signedIn: managerId !== null })
  if (to) redirect(to)

  const [seasons, issues, auctions] = await Promise.all([
    listHistorySeasons(),
    listIssues(),
    listAuctions(),
  ])

  // The reigning champion is the most recent season that has one — not simply
  // the newest season, which between August and January has been drafted but not
  // yet won.
  const reigning = seasons.find((s) => s.champion !== null) ?? seasons[0] ?? null

  // Depends on which season is reigning, so it cannot join the batch above.
  // Null for 2006–2019, which have a champion's name and no week-by-week record.
  const lineup = reigning?.champion ? await getChampionshipLineup(reigning.season) : null

  // The most recent auction with picks in it. `listAuctions()` is built from
  // `picks`, so a season appears exactly when somebody drafted in it — which
  // means this is empty, not zero, before the first nomination of a new year.
  const auction = auctions.find((a) => a.picks > 0) ?? null

  // `issueArt` is a filesystem check, not a fetch — the art is generated once by
  // the Gazette script and committed. Null is the normal case for any issue
  // written before the art step existed.
  const head = issues[0]
  const latest: IssueTeaser | null = head
    ? { ...head, image: issueArt(head.season, head.week) }
    : null

  // Titles are counted by display name, which is what `listHistorySeasons()`
  // resolves for both eras — a `champion_manager_id` for the Sleeper years and a
  // bare `legacy_champions.champion_name` for 2006–2010. Counting on the id
  // instead would quietly drop a five-time champion's early rings.
  const titles = reigning?.champion
    ? seasons.filter((s) => s.champion === reigning.champion).length
    : 0

  const groups = SECTIONS.map((s) => ({
    label: s.label,
    // `commishOnly` items are dropped rather than gated: this page has no
    // session to check against, and `/setup` re-reads `is_commish` from the
    // database anyway. A link the reader cannot use is worse than no link.
    items: s.items.filter((i) => !i.commishOnly),
  }))

  return (
    <main className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav current="/" />
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </header>

      <StatusStrip live={live} />

      {/*
        Monument. The lead and the ribbon are **full-bleed** — they run edge to
        edge rather than sitting inside the measure, because the name is the
        picture and a picture with a margin is a thumbnail. Everything below the
        ribbon returns to `max-w-6xl`, which is where reading resumes.

        `max-w-6xl` and not the `max-w-[92rem]` the table pages use: those need
        every pixel for sixteen columns of roster, and a front page stretched
        that wide just puts a lake of empty ground between its columns.
      */}
      <ChampionLead season={reigning} titles={titles} lineup={lineup} />

      <ChampionRibbon seasons={seasons} />

      <div className="mx-auto max-w-6xl px-4 py-12">
        <GazetteTeaser issue={latest} />

        <div className="mt-14">
          <AuctionNumbers auction={auction} />
        </div>

        <div className="mt-14">
          <Contents groups={groups} />
        </div>
      </div>
    </main>
  )
}
