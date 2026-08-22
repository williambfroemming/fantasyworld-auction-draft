import Link from 'next/link'
import { managerColor } from '@/lib/colors'
import type { ChampionshipLineup, SeasonListing } from '@/server/history-service'
import type { LiveSeason } from '@/server/draft-service'

/**
 * The furniture of the front page. Direction: **Monument**.
 *
 * ## The thesis
 *
 * Every other screen in this app is a dense information grid, because every
 * other screen answers a specific question. The front page answers "whose league
 * is this", and it answers it with one word set larger than anything else in the
 * app — **the champion's name is the picture.** There is deliberately no imagery
 * above the fold to compete with it.
 *
 * Three moves carry it, all of them devices the design system already owns:
 *
 * 1. **Type as the image.** The name runs to `clamp(3.5rem, 13vw, 8rem)` at a
 *    `0.84` leading. Interior pages top out near `text-lg`. Nothing else on the
 *    page comes close, which is what makes it read as a front page rather than a
 *    sixth interior one.
 * 2. **A ribbon, not a table.** Every champion the league has had runs
 *    continuously beneath the lead — a stadium ribbon board. Twenty-one seasons
 *    is too many to list on a front page and exactly right to run past.
 * 3. **The art sits below the fold, letterboxed.** A press photo beside its
 *    story, not a hero behind it. The Gazette's generated image is the only
 *    picture on the page and it stays subordinate to the type.
 *
 * ⚠️ Empty states are **designed, not defaulted**, because this page will hit
 * all of them: a season with no champion, a champion with no prize recorded, no
 * Gazette issues, and — for a long while yet — no generated art. Each has a
 * composed appearance below. None is a blank block or an empty bordered box.
 */

/** Money, or an em dash. Never `$0` — null is unknown, not nothing. */
function money(n: number | null): string {
  return n === null ? '—' : `$${n.toLocaleString('en-US')}`
}

function place(city: string | null, state: string | null): string | null {
  if (city && state) return `${city}, ${state}`
  return city ?? state ?? null
}

function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

/**
 * One line, and it stays one line.
 *
 * The moment this grows a second row of figures it becomes a stats panel, and it
 * would compete with the lead — which is the one thing on this page allowed to
 * be loud.
 */
export function StatusStrip({ live }: { live: LiveSeason | null }) {
  if (!live) return null

  const bits = [
    `${live.season} season`,
    live.unfilled === 0 ? 'draft complete' : `${live.unfilled} rosters open`,
    `${live.picks} picks`,
  ]

  return (
    <div className="border-b border-rule">
      <div className="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 font-display text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {bits.map((b, i) => (
          <span key={b} className="flex items-baseline gap-3">
            {i > 0 && (
              <span aria-hidden className="text-slate-600">
                ·
              </span>
            )}
            <span>{b}</span>
          </span>
        ))}
        <Link
          href="/board"
          className="ml-auto text-slate-300 underline-offset-4 hover:text-amber-300 hover:underline"
        >
          The board →
        </Link>
      </div>
    </div>
  )
}

/**
 * The lead. One name, as large as the viewport will take.
 *
 * ⚠️ The **reigning** champion only. The full roll runs in the ribbon below and
 * the complete table is `/history` — this is the headline, not the record.
 */
export function ChampionLead({
  season,
  titles,
  lineup,
}: {
  season: SeasonListing | null
  /** How many titles this champion has, across every season on record. */
  titles: number
  /** The team he won it with. Null before 2020 — see `getChampionshipLineup`. */
  lineup: ChampionshipLineup | null
}) {
  if (!season) return null

  const where = place(season.city, season.state)

  // Drafted but not yet won — the honest headline from August to January, and
  // the one this page will wear for months at a time.
  if (!season.champion) {
    return (
      <section className="px-4 pt-10 pb-8">
        <div className="mx-auto max-w-6xl">
          <p className="font-display text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-slate-400">
            {season.season} season
          </p>
          <h2 className="mt-3 font-display text-[clamp(3rem,11vw,7rem)] leading-[0.86] font-bold tracking-[-0.02em] text-slate-50">
            In progress
          </h2>
          <p className="mt-5 max-w-prose text-slate-300">
            No champion on record yet.{where && ` Drafted in ${where}.`}
          </p>
        </div>
      </section>
    )
  }

  const accent = season.championColor ? managerColor(season.championColor) : null

  return (
    <section className="px-4 pt-10 pb-8">
      <div className="mx-auto max-w-6xl">
        {/*
          Sentence case, and deliberately **not** `uppercase`. That utility is
          wired to swap in the condensed gothic (see globals.css) because
          everywhere else in this app uppercase means a label or a badge — and a
          congratulation set in caps reads as shouting at the reader rather than
          congratulating anybody. Amber because it is the highlight role, and
          this is the one warm sentence on the page.
        */}
        <p className="font-display text-base font-semibold tracking-tight text-amber-300 sm:text-lg">
          Congratulations to our {season.season} Champion!
        </p>

        {/*
          The name and the lineup share one row and are **top-aligned** — the
          lineup's eyebrow sits level with the cap height of the name rather than
          starting below it.

          Both tracks are `minmax(0,…)`. A `.leaders` row is `white-space:
          nowrap`, and a bare `fr` is `minmax(auto, …)` which refuses to shrink
          below that, so the two columns end up drawn on top of each other.
        */}
        <div className="mt-3 grid items-start gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div>
            {/*
              `12vw`, down from the 16vw it ran at when the name had the row to
              itself. The name is still far and away the largest type in the app
              — interior pages top out near `text-lg` — but it now has to share
              the measure, and a longer name (`Eric/Blakey`) wraps rather than
              running under the lineup, hence `break-words`.
            */}
            <h2 className="flex items-stretch gap-4 font-display text-[clamp(3rem,12vw,11rem)] leading-[0.84] font-bold tracking-[-0.03em] text-slate-50">
              {/*
                The one piece of colour on the page, and it belongs to a person.
                `managerColor()` rather than the stored hex: the stored value is
                the dark-theme ink, and the neon originals vanish on newsprint.
              */}
              {accent && (
                <span
                  aria-hidden
                  className="w-1.5 shrink-0 self-stretch"
                  style={{ backgroundColor: accent }}
                />
              )}
              <span className="min-w-0 break-words">{season.champion}</span>
            </h2>

            {/*
              ⚠️ The headline slot shows the **prize when it is known and the
              title count when it is not** — it does not print a lone em dash
              under a heading that says "The prize".

              A dash is the right answer inside a list of rows, where the label
              beside it explains what is missing. As the one prominent line under
              its own heading it just reads as a page that failed to load, which
              is a worse lie than "unknown": it makes the reader doubt the whole
              panel. The prize is genuinely unrecorded for several seasons —
              `npm run season:info -- <year> --champion <amount>` fills it in —
              and the title count is derived from data that always exists.
            */}
            <div className="mt-8">
              {season.championPrize !== null ? (
                <>
                  <p className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    The prize
                  </p>
                  <p className="mt-1 font-mono text-sm text-slate-100 tabular-nums">
                    {money(season.championPrize)}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    The title
                  </p>
                  {/* Not "1st for Gabes" — the name is set six inches above in
                      the largest type on the site. */}
                  <p className="mt-1 text-sm text-slate-100">{ordinal(titles || 1)} title</p>
                </>
              )}

              <dl className="mt-3 max-w-md space-y-1">
                {where && (
                  <div className="leaders text-xs">
                    <span className="text-slate-400">Drafted in</span>
                    <span className="text-slate-300">{where}</span>
                  </div>
                )}
                {season.championPrize !== null && (
                  <div className="leaders text-xs">
                    <span className="text-slate-400">Titles</span>
                    <span className="font-mono text-slate-300 tabular-nums">
                      {ordinal(titles || 1)}
                    </span>
                  </div>
                )}
                {season.buyIn !== null && (
                  <div className="leaders text-xs">
                    <span className="text-slate-400">Buy-in</span>
                    <span className="font-mono text-slate-300 tabular-nums">
                      {money(season.buyIn)}
                    </span>
                  </div>
                )}
              </dl>

              <Link
                href="/history"
                className="mt-4 inline-block font-display text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-slate-400 underline-offset-4 hover:text-amber-300 hover:underline"
              >
                The all-time table →
              </Link>
            </div>
          </div>

          <ChampionLineup lineup={lineup} />
        </div>
      </div>
    </section>
  )
}

/**
 * Lineup slots in the order a box score prints them, not the order they scored.
 *
 * A leaderboard sorted by points is a different claim from a lineup — it says
 * "here are the best performances", where this says "here is the team he put on
 * the field". The second is the one that gives somebody their flowers, and it is
 * also how anyone who plays this game reads a roster.
 */
const SLOT_ORDER = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF']

/** `SUPER_FLEX` is Sleeper's spelling and nobody says it out loud. */
const SLOT_LABEL: Record<string, string> = {
  SUPER_FLEX: 'SFLX',
  FLEX: 'FLEX',
  DEF: 'DEF',
}

function slotRank(slot: string): number {
  const i = SLOT_ORDER.indexOf(slot)
  return i === -1 ? SLOT_ORDER.length : i
}

/**
 * The team that actually won it.
 *
 * This sits in the space beside the lead, which the Monument layout otherwise
 * leaves empty — and it is the answer to "give him his flowers": not that he
 * won, which the headline already says, but *who he had on the field* on the
 * day, and what each of them did.
 */
export function ChampionLineup({ lineup }: { lineup: ChampionshipLineup | null }) {
  if (!lineup) return null

  const starters = [...lineup.starters].sort(
    (a, b) => slotRank(a.slot) - slotRank(b.slot) || b.points - a.points,
  )
  const best = Math.max(...starters.map((s) => s.points))

  return (
    <div>
      <p className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
        The team that won it · week {lineup.week}
      </p>

      {/*
        Said as a sentence, not as `127.28 — 95.90 Jack`, which reads as a range
        with a name after it and leaves the reader working out who won a game
        the headline already told them was won.
      */}
      <p className="mt-1 text-sm text-slate-300">
        {lineup.opponent && lineup.opponentPoints !== null ? (
          <>
            Beat {lineup.opponent},{' '}
            <span className="font-mono tabular-nums">
              {lineup.points.toFixed(2)}–{lineup.opponentPoints.toFixed(2)}
            </span>
          </>
        ) : (
          <span className="font-mono tabular-nums">{lineup.points.toFixed(2)}</span>
        )}
      </p>

      {/* Capped so the dot leaders carry the eye across a gap rather than a
          field — at half of `max-w-6xl` they run for 570px of nothing. */}
      <ul className="mt-3 max-w-md space-y-1">
        {starters.map((s, i) => (
          <li key={`${s.slot}-${s.playerName}-${i}`} className="leaders text-xs">
            <span>
              <span className="inline-block w-10 font-display text-[0.58rem] font-semibold uppercase tracking-[0.1em] text-slate-500">
                {SLOT_LABEL[s.slot] ?? s.slot}
              </span>
              {/* The day's top scorer is the only highlighted name — one mark,
                  so it means something. */}
              <span className={s.points === best ? 'text-amber-300' : 'text-slate-200'}>
                {s.playerName}
              </span>
            </span>
            <span
              className={`font-mono tabular-nums ${
                s.points === best ? 'text-amber-300' : 'text-slate-400'
              }`}
            >
              {s.points.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Every champion the league has had, running continuously.
 *
 * The list is rendered **twice** — the animation travels exactly -50%, so the
 * second copy lands where the first began and the loop has no seam. See
 * `.ribbon` in `globals.css`, which also handles the reduced-motion case by
 * turning the whole thing into an ordinary scroller rather than freezing it.
 *
 * ⚠️ The second copy is `aria-hidden`. Without it a screen reader announces
 * twenty-one champions as forty-two.
 */
export function ChampionRibbon({ seasons }: { seasons: SeasonListing[] }) {
  const winners = seasons.filter((s) => s.champion !== null)
  // One name cannot run past itself convincingly, and two is a list.
  if (winners.length < 3) return null

  const run = (hidden: boolean) => (
    <div className="ribbon-track" aria-hidden={hidden || undefined}>
      {winners.map((s) => (
        <span key={`${hidden ? 'b' : 'a'}-${s.season}`} className="flex shrink-0 items-baseline gap-2 px-6">
          <span className="font-mono text-xs text-slate-500 tabular-nums">{s.season}</span>
          <span className="font-display text-lg font-bold text-slate-200">{s.champion}</span>
        </span>
      ))}
    </div>
  )

  return (
    <section
      aria-label="Every champion on record"
      className="border-y border-rule bg-slate-900 py-3"
    >
      <div className="ribbon">
        {run(false)}
        {run(true)}
      </div>
    </section>
  )
}

export interface IssueTeaser {
  season: number
  week: number
  headline: string
  deck: string
  weekLabel: string
  /**
   * The generated art for this issue, or null until it has been made. A public
   * path, written by the Gazette script — never fetched at request time.
   */
  image: string | null
}

/**
 * The week's Gazette, with its art letterboxed beside it like a press photo.
 *
 * The headline is set in `--font-gazette` (Playfair), otherwise reserved to the
 * Gazette itself. This is the one place off that page where the face is
 * **quoting the paper** rather than decorating — it tells the reader where the
 * link goes before they read the words.
 *
 * ⚠️ With no art the block goes **full width instead of leaving a hole**. An
 * empty letterbox where a photo should be reads as a broken image, which is a
 * worse answer than a headline that simply has no picture yet.
 */
export function GazetteTeaser({ issue }: { issue: IssueTeaser | null }) {
  if (issue === null) {
    return (
      <section className="rule-strong pt-4">
        <p className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
          The Gazette
        </p>
        <p className="mt-3 text-sm text-slate-400">
          No issues yet.{' '}
          <Link
            href="/history/gazette"
            className="text-slate-300 underline-offset-4 hover:text-amber-300 hover:underline"
          >
            The archive
          </Link>
        </p>
      </section>
    )
  }

  const href = `/history/gazette/${issue.season}/${issue.week}`

  return (
    <section className="rule-strong pt-4">
      <p className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
        The Gazette · {issue.weekLabel}
      </p>

      <div
        className={`mt-3 grid gap-x-8 gap-y-4 ${issue.image ? 'md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]' : ''}`}
      >
        {issue.image && (
          <Link href={href} className="block">
            {/*
              A plain `img`, not `next/image`. The file is generated once by the
              Gazette script and committed — there is no remote loader to
              configure and nothing to optimise at request time.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={issue.image}
              alt=""
              loading="lazy"
              className="aspect-[16/9] w-full border border-rule object-cover"
            />
          </Link>
        )}

        <div>
          <h2 className="font-gazette text-2xl leading-tight font-bold text-slate-50 sm:text-3xl">
            <Link href={href} className="underline-offset-4 hover:text-amber-300 hover:underline">
              {issue.headline}
            </Link>
          </h2>
          <p className="mt-3 max-w-prose leading-relaxed text-slate-300">{issue.deck}</p>
          <Link
            href="/history/gazette"
            className="mt-4 inline-block font-display text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-slate-400 underline-offset-4 hover:text-amber-300 hover:underline"
          >
            Every issue →
          </Link>
        </div>
      </div>
    </section>
  )
}

/**
 * The auction that just finished, in three figures.
 *
 * ⚠️ **Every figure here has to be one that can move.** The first cut led with
 * *total spent* and *players sold*, and both are constants: the room spends
 * $1,979–$2,000 of its $2,000 every single year, and the pick count is always
 * `managers × rosterSize` — 160, forever. Two thirds of the band could never
 * say anything, which is a worse failure than being uninteresting, because it
 * looks like data.
 *
 * What actually varies across the six auctions on record:
 *
 *     top price   $51 – $66
 *     median       $3 – $7
 *     $1 players   31 – 53      ← the widest spread, and the most telling
 *
 * The dollar count is the one that says something: a draft where 53 players go
 * for a dollar is a room that spent early and ran out, and a draft where 31 do
 * is a room that held money back. That is a fact about the people, which is what
 * a front page is for. The totals still exist on `/stats`, in context.
 */
export function AuctionNumbers({
  auction,
}: {
  auction: {
    season: number
    picks: number
    medianPrice: number
    dollarPicks: number
    topPick: { playerName: string; price: number; displayName: string } | null
  } | null
}) {
  if (!auction || auction.picks === 0) return null

  return (
    <section className="rule-strong pt-4">
      <p className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
        The {auction.season} auction
      </p>
      <div className="mt-3 grid gap-x-10 gap-y-4 sm:grid-cols-3">
        {auction.topPick && (
          <div>
            <p className="font-display text-2xl font-bold text-slate-50">
              {auction.topPick.playerName}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              <span className="font-mono text-slate-200 tabular-nums">
                {money(auction.topPick.price)}
              </span>{' '}
              — the priciest of the night, to {auction.topPick.displayName}
            </p>
          </div>
        )}
        <div>
          <p className="font-mono text-2xl font-bold text-slate-50 tabular-nums">
            {money(auction.medianPrice)}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            median price — half the board went for less
          </p>
        </div>
        <div>
          <p className="font-mono text-2xl font-bold text-slate-50 tabular-nums">
            {auction.dollarPicks}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            went for a dollar ·{' '}
            <Link href="/stats" className="underline-offset-4 hover:text-amber-300 hover:underline">
              where the money went →
            </Link>
          </p>
        </div>
      </div>
    </section>
  )
}

/**
 * The index across the foot of the page.
 *
 * Sourced from `SiteNav`'s own `SECTIONS` by the page, never retyped, so the nav
 * and the front page cannot drift into naming the same screens differently.
 *
 * ⚠️ **Labels only — deliberately no hints.** The first cut rendered each item
 * with the same one-line hint the nav menu shows, and the result was the top of
 * the page restated at the bottom, word for word. A newspaper index lists
 * sections; it does not re-describe them.
 */
export function Contents({
  groups,
}: {
  groups: Array<{ label: string; items: Array<{ href: string; label: string }> }>
}) {
  return (
    <section className="rule-strong pt-4">
      <div className="grid gap-x-10 gap-y-6 sm:grid-cols-3">
        {groups.map((g) => (
          <div key={g.label}>
            <p className="font-display text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {g.label}
            </p>
            <ul className="mt-2 space-y-1.5">
              {g.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="font-display text-base text-slate-200 underline-offset-4 hover:text-amber-300 hover:underline"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
