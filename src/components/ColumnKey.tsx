/**
 * The footnote under a table: a short key for the columns whose names do not
 * explain themselves, and nothing else.
 *
 * It replaced a run-on paragraph of bolded terms under each panel. Each entry
 * is a few words — if a column needs a sentence, the sentence belongs in the
 * glossary and the panel heading carries the `?` that links to it.
 */
export function ColumnKey({
  lead,
  items,
}: {
  /** Optional plain line before the terms, e.g. how many simulations ran. */
  lead?: React.ReactNode
  /** `false` entries are skipped, so a column that is not drawn can drop its key inline. */
  items: Array<[term: string, definition: string] | false>
}) {
  return (
    <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-rule pt-3 text-xs">
      {lead && <p className="text-slate-500">{lead}</p>}
      <dl className="contents">
        {items
          .filter((i) => i !== false)
          .map(([term, definition]) => (
            <div key={term} className="flex gap-1.5">
              <dt className="font-semibold text-slate-300">{term}</dt>
              <dd className="text-slate-500">{definition}</dd>
            </div>
          ))}
      </dl>
    </div>
  )
}
