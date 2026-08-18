/**
 * Hand-pinned player identities (docs/BACKLOG.md §2).
 *
 * `resolveSleeperIds` matches on name, position and team, and deliberately
 * refuses to guess when two players share a name and the team does not separate
 * them. That refusal is correct — a wrong match silently attributes one
 * player's price history to another — but it leaves a handful of players
 * unresolved every year. This is where they get pinned by hand.
 *
 * **This file is expected to have entries, and expected to stay small.** §2's
 * own advice: budget for a manual override table for the 5–10 players that
 * never match; do not budget for a matcher that gets to 100%.
 *
 * Keys are `players.id` — the Sleeper id or the derived CSV slug, whichever
 * seeded the pool. Values are Sleeper player ids.
 *
 * ⚠️ CSV slugs are derived from the name, so they change if the source spells a
 * player differently next year. An override that stops matching simply stops
 * applying — it will not throw, and the player falls back to unresolved. Re-run
 * `npm run db:migrate-identity` after a pool import and read what it reports as
 * unresolved rather than assuming these still bite.
 */
export const PLAYER_ID_OVERRIDES: Record<string, string> = {
  // Example of the shape — two Mike Williamses, neither on the CSV's team:
  // 'csv-mike-williams-WR': '4068',
}
