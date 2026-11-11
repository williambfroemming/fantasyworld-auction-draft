/**
 * The data behind a chart, as a table only a screen reader sees. Every chart renders one,
 * so the numbers are never trapped in a picture. `null` cells read as "no data", never 0.
 */
export function ChartTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: Array<{ label: string; cells: Array<string | null> }>;
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Item</th>
          {columns.map((c) => (
            <th key={c} scope="col">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <th scope="row">{r.label}</th>
            {r.cells.map((c, i) => (
              <td key={i}>{c ?? "no data"}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
