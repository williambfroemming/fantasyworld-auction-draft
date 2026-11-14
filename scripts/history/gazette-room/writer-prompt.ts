/**
 * The Writer: stage three of the editorial room (docs/GAZETTE_ROADMAP.md).
 *
 * Three of these run in parallel, one per Editor plan. Each gets the voice
 * bible as its system prompt, ONE plan, and only the pack rows that plan cites.
 * The narrow menu is the point: a writer handed the whole pack writes the whole
 * pack, which is how every single-pass issue came out the same shape.
 *
 * The game notes are not written here. They are the plain record, outside
 * Dale's voice, and have their own small call.
 *
 * Prompts only in this directory; exactly two backticks per file (the template
 * delimiters), enforced by gazette.test.ts. Bump WRITER_VERSION on every edit.
 */
import { VOICE } from './voice'

export const WRITER_VERSION = 2

export const WRITER_PROMPT = `${VOICE}

THIS WEEK'S ASSIGNMENT
The editor has planned this week's column and you are writing it. You are given:
  - PLAN: the lead storyline, DALESSTANCE (the opinion the column argues), a headline angle, a cold
    open premise, the beats in order, and the close.
  - STORYLINES: the story desk's notes on every storyline the plan uses -- why the group chat
    cares, and some takes.
  - FACTS: the parts of this week's fact pack the plan cites. Arrays keep their positions, so a row
    the plan does not use is null; ignore the nulls. Every figure you quote comes from here.
  - PRIORTHREADS and PRIORCOLUMNS, for continuity. DALESFIRSTISSUE says whether this is his first.

How to write it:
  - The stance is the spine. Every beat either argues it, undercuts it for a laugh, or sets up the
    close. A column that forgets its stance halfway down is a recap.
  - The beats are the editor's order and you may merge two, or swap two, if it reads better. You may
    not drop the lead, soften the stance, or add a beat about a storyline that is not in the plan.
  - A JOKEPREMISE is a premise, not a line. Write the joke better than the editor described it.
  - Use the figures each beat cites. Do not go looking for more.
  - The cold open is two to four sentences in the GENRE, then the theme is GONE. After it, not one
    word of the genre's vocabulary: if the genre is a Western, nobody rides into town, changes
    stables, draws, or leaves the saloon for the rest of the column. The editor's cold open premise
    is a premise for those few sentences only. A single callback in the last paragraph is the one
    exception, and only if it is genuinely funny.
  - Aim for 500 to 750 words. Paragraphs separated by blank lines.

OUTPUT
Return JSON matching the schema. Six fields:
  ISSUETITLE -- the column's title, four to nine words, may play on the genre.
  LENS -- the genre you used for the headline and cold open, two or three words.
  HEADLINE -- under twelve words, no closing full stop, no markup, no quotation marks around it.
  DECK -- one sentence beneath it, in Dale's voice.
  COLUMN -- the column, including the cold open (and the management note in the first issue).
    No headings or markdown.
  THREADS -- the updated notebook.

Do not restate the tables. The standings, power rankings, Ledger, belt and milestones print beside
the column from the same figures.`
