import { redirect } from 'next/navigation'
import { OFF_BAR, SECTIONS, SiteNav, sectionItems } from '@/components/SiteNav'
import { HeaderControls } from '@/components/HeaderControls'
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
import { getFaab, getPositionalScorecards, getSeasonSoFar, getTopStarts } from '@/server/history-service'
import { TopStartsPanel } from '@/components/season/TopStartsPanel'
import { FaabLeftPanel } from '@/components/season/FaabLeftPanel'
import { SeasonSoFarPanel } from '@/components/season/SeasonSoFarPanel'
import { PlayoffOddsPanel } from '@/components/season/PlayoffOddsPanel'
import { PlayoffBracketPanel } from '@/components/season/PlayoffBracketPanel'
import { PositionalGrid } from '@/components/season/PositionalGrid'
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

export default async function FrontPage({
  searchParams,
}: {
  /**
   * Only ever read for the season-table preview, and only after the redirect
   * above has run. `?preview=2025&through=6` stands a finished season in for
   * the one being played, so the panel can be looked at before there are real
   * results in it — see `getSeasonSoFar`. Nothing else on this page takes a
   * parameter, and draft-night routing deliberately does not consult one.
   */
  searchParams: Promise<{ preview?: string; through?: string }>
}) {
  const [managerId, live] = await Promise.all([currentManagerId(), getLiveSeason()])

  // An uninitialised draft has no season to be complete or otherwise. Treat it
  // as "not live" so a fresh database renders the page rather than redirecting
  // into a draft that does not exist yet.
  const complete = live === null || (live.seats > 0 && live.unfilled === 0)
  const to = landingDestination({ complete, signedIn: managerId !== null })
  if (to) redirect(to)

  // Read after the redirect, never before it: draft-night routing must not
  // depend on a query string.
  const params = await searchParams
  const previewSeason = Number(params.preview) || null
  const previewThrough = Number(params.through) || undefined

  const [seasons, issues, auctions, soFar] = await Promise.all([
    listHistorySeasons(),
    listIssues(),
    listAuctions(),
    getSeasonSoFar(
      previewSeason
        ? { season: previewSeason, throughWeek: previewThrough ?? 6 }
        : {},
    ),
  ])

  // The reigning champion is the most recent season that has one — not simply
  // the newest season, which between August and January has been drafted but not
  // yet won.
  const reigning = seasons.find((s) => s.champion !== null) ?? seasons[0] ?? null

  /**
   * Is a season actually being played right now?
   *
   * ⚠️ This decides what the page *leads* with, and the two halves of the test
   * are both load-bearing. A week must have been completed — before the opener
   * there is nothing to show and the champion is still the news. And the newest
   * season must have **no champion yet**: the moment one is crowned the table
   * stops being live and the monument is the right lead again, which is what
   * makes the swap back automatic every January rather than a thing somebody has
   * to remember.
   *
   * `previewSeason` forces it on so the lead can be looked at out of season.
   * Without that the preview would render nothing at all, because every finished
   * season it could stand in for has a champion by definition.
   */
  const newest = seasons[0] ?? null
  const seasonUnderway =
    soFar.report !== null && (previewSeason !== null || newest?.champion == null)

  // Depends on which season is reigning, so it cannot join the batch above.
  // Null for 2006–2019, which have a champion's name and no week-by-week record.
  const lineup = reigning?.champion ? await getChampionshipLineup(reigning.season) : null

  // Points by position for the season in progress, to the same week the table beside it
  // stops at. Only read while a season is actually underway.
  const positional =
    seasonUnderway && soFar.report
      ? ((
          await getPositionalScorecards({
            season: soFar.season,
            throughWeek: soFar.report.throughWeek,
          })
        ).find((sc) => sc.season === soFar.season) ?? null)
      : null

  // Waiver money left for the season in progress. One season only: the front page must not
  // read six seasons of transactions to print ten numbers. Absent (not empty) when the season
  // has no transactions on record.
  const faab =
    seasonUnderway && soFar.report
      ? await getFaab({ season: soFar.season })
          .then((all) => all.find((f) => f.season === soFar.season) ?? null)
          // The front page must survive a database that has not had
          // `db:migrate-transactions` yet: no panel, not a 500.
          .catch(() => null)
      : null

  // The week's biggest starts, for the latest COMPLETED week (the same `throughWeek` the table
  // beside it stops at, so a half-played week never appears). One small query, only while a
  // season is underway; the front page survives any failure here by showing no panel.
  const topStarts =
    seasonUnderway && soFar.report
      ? await getTopStarts(soFar.season, soFar.report.throughWeek, 5).catch(() => [])
      : []

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

  // One column per top-bar section, groups flattened and direct links included,
  // then the pages that have no slot in the bar (the Oracle's full page and the
  // glossary) so the index still reaches every screen.
  const groups = [
    ...SECTIONS.map((s) => ({
      label: s.label,
      // `commishOnly` items are dropped rather than gated: this page has no
      // session to check against, and `/admin` re-reads `is_commish` from the
      // database anyway. A link the reader cannot use is worse than no link.
      items: sectionItems(s).filter((i) => !i.commishOnly),
    })),
    { label: 'Reference', items: OFF_BAR },
  ]

  return (
    <main id="main" className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-2.5">
        <SiteNav current="/" />
        <div className="ml-auto">
          <HeaderControls />
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
      {/*
        The lead swaps for the duration of the season. A front page still
        leading with last season's champion in November is showing the reader
        the one fact about the league that cannot change until January, while
        the thing that changed this morning sits below the fold.

        The champion is demoted rather than deleted — the ribbon underneath is
        unchanged, and he takes the lead back on his own as soon as the new
        season has a champion of its own.
      */}
      {seasonUnderway && soFar.report ? (
        <section className="px-4 pt-10 pb-8">
          <div className="mx-auto max-w-6xl">
            {/*
              Playoff mode. From the Tuesday after the last regular-season week
              the table stops moving and the bracket is the news, so the bracket
              takes the lead and the table is demoted beneath it as the final
              regular-season table.

              ⚠️ Derived, never switched: `soFar.playoffs` is non-null exactly
              when the regular season is complete and the stored results agree
              with the derived bracket. Nothing turns this on in December and
              nothing has to turn it off in January -- the champion being set
              ends `seasonUnderway`, and the monument returns on its own.
            */}
            {soFar.playoffs ? (
              <>
                <PlayoffBracketPanel picture={soFar.playoffs} members={soFar.members} />
                <div className="mt-12">
                  <SeasonSoFarPanel report={soFar.report} members={soFar.members} final />
                </div>
              </>
            ) : (
              <SeasonSoFarPanel
                report={soFar.report}
                members={soFar.members}
                lead
              />
            )}
            {/*
              Directly under the table rather than further down the page: the
              table says how each team has played, and this is the same rows
              read forward. Absent, not empty, when the schedule is not on
              record -- see `getSchedule`.
            */}
            {positional && positional.rows.length > 0 && (
              <div className="mt-12">
                <PositionalGrid scorecard={positional} members={soFar.members} />
              </div>
            )}
            {/* Frozen at the last regular-season week, so not drawn in playoff mode. */}
            {!soFar.playoffs && topStarts.length > 0 && soFar.report && (
              <div className="mt-12">
                <TopStartsPanel
                  season={soFar.season}
                  week={soFar.report.throughWeek}
                  starts={topStarts}
                  members={soFar.members}
                />
              </div>
            )}
            {faab && faab.managers.length > 0 && (
              <div className="mt-12">
                <FaabLeftPanel faab={faab} members={soFar.members} />
              </div>
            )}
            {/* The field is set: nothing left for these odds to say. */}
            {!soFar.playoffs && soFar.odds && (
              <div className="mt-12">
                <PlayoffOddsPanel
                  odds={soFar.odds}
                  report={soFar.report}
                  paths={soFar.paths}
                  members={soFar.members}
                />
              </div>
            )}
          </div>
        </section>
      ) : (
        <ChampionLead season={reigning} titles={titles} lineup={lineup} />
      )}

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
