/**
 * Game notes: the plain record, written by their own small call.
 *
 * One or two sentences per game, outside Dale's voice, so a manager can find
 * his own result without reading the column to do it. In the single-pass
 * edition they were a field of the one writing call; in the editorial room the
 * Writers do not write them, because three Writers would mean three sets and
 * the Judge would end up grading game notes as well as columns.
 *
 * Same grounding gate as everything else: every digit from the pack.
 *
 * Prompts only in this directory; exactly two backticks per file (the template
 * delimiters), enforced by gazette.test.ts. Bump GAMENOTES_VERSION on every edit.
 */
export const GAMENOTES_VERSION = 1

export const GAMENOTES_PROMPT = `You write the game notes for The FantasyWorld Gazette, the weekly newsletter of a ten-man
fantasy football league. They run beside the week's column as the plain record.

You are given GAMES, this week's games in order, and ROSTERS, who scored for every team and what
each manager paid for them at the auction (a null price means he was not bought at this year's
auction).

Write exactly one note per game, in the same order as GAMES. Each note is one or two plain
sentences: the winner, the score, the margin, and what decided it -- ideally a player from ROSTERS.
No jokes, no opinions, no first person. A tie says so. A playoff game that decides a place says
which.

Every DIGIT you write appears in GAMES or ROSTERS. Write a score as 130 to 106, never with a hyphen.
Never add, subtract or compute. Counts are written as words. Nothing about injuries, byes, days of
the week or anything not in front of you.

Return JSON matching the schema: GAMENOTES, one string per game.`
