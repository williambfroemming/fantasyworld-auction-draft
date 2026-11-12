/**
 * The example questions shown as chips in the Oracle (the full page and the Ask launcher).
 *
 * A chip only FILLS the input; the member still presses Ask, so nothing here ever runs a query,
 * and nothing is fetched when a page loads. Kept as plain strings so the list can be tested:
 * short enough for a phone, no markdown, no backticks.
 *
 * The mix is deliberate: some about points and the auction, some about the NFL stat lines
 * (`player_week_stats`) and some about waivers and FAAB (`transactions`), so a member can see
 * those questions are answerable. Each stat question names a position or a player, because the
 * league compares within a position and a stat across positions measures nothing.
 */
export const ORACLE_EXAMPLES: readonly string[] = [
  'How many times has Josh Allen scored over 20 points?',
  'Who has the most 150-point weeks?',
  'What is the most anyone has paid for a running back?',
  'Which player has been started the most weeks?',
  'Which receiver had the most receiving yards in a season?',
  'How many passing yards did Josh Allen have in 2023?',
  'How much FAAB did each manager spend in 2025?',
  'What is the most anyone has paid for a waiver claim?',
]

/** The longest a chip may be, so it never wraps to three lines on a phone. */
export const MAX_EXAMPLE_LENGTH = 70
