"use client";

import { ChartTable } from "./ChartTable";
import { CHART_INKS, INK, INK_SOFT } from "./colors";
import { formatValue, type Fmt } from "./format";
import { linearScale } from "./scale";
import { useWidth } from "./useWidth";

export interface BarRow {
  id: string;
  label: string;
  /** Null is unknown: the row is listed with a dash and no bar, never a zero-length bar. */
  value: number | null;
  color?: string;
}

const ROW_H = 26;
const FONT = 12;

/** Horizontal bars, one value per row, the value printed at the end of each bar. */
export function BarChart({
  rows,
  format: fmt,
  ariaLabel,
  max,
}: {
  rows: BarRow[];
  format?: Fmt;
  ariaLabel: string;
  /** Fix the scale (e.g. 100 for percentages); default is the largest value. */
  max?: number;
}) {
  const format = (v: number) => formatValue(fmt, v);
  const [ref, width, ready] = useWidth();
  const labelW = Math.min(150, Math.round(width * 0.38));
  const valueW = 64;
  const barW = Math.max(20, width - labelW - valueW - 8);
  const top = max ?? Math.max(1, ...rows.map((r) => r.value ?? 0));
  const sx = linearScale([0, top], [0, barW]);
  const height = rows.length * ROW_H + 4;
  const maxChars = Math.floor((labelW - 8) / (FONT * 0.56));

  return (
    <div ref={ref} className="w-full" style={{ minHeight: height }}>
      {ready && (
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={ariaLabel}
          className="block max-w-full"
        >
          {rows.map((r, i) => {
            const y = i * ROW_H + 2;
            const w =
              r.value === null
                ? 0
                : Math.max(r.value > 0 ? 1 : 0, sx(Math.max(0, r.value)));
            const label =
              r.label.length > maxChars
                ? r.label.slice(0, Math.max(1, maxChars - 1)) + "…"
                : r.label;
            return (
              <g key={r.id}>
                <text
                  x={labelW - 8}
                  y={y + ROW_H / 2}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={FONT}
                  style={{ fill: INK_SOFT }}
                >
                  {label}
                </text>
                {r.value !== null && (
                  <rect
                    x={labelW}
                    y={y + 3}
                    width={w}
                    height={ROW_H - 8}
                    style={{ fill: r.color ?? CHART_INKS[0] }}
                  />
                )}
                <text
                  x={labelW + w + 6}
                  y={y + ROW_H / 2}
                  dy="0.32em"
                  fontSize={FONT}
                  fontWeight={600}
                  className="tabular-nums"
                  style={{ fill: INK }}
                >
                  {r.value === null ? "—" : format(r.value)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <ChartTable
        caption={ariaLabel}
        columns={["Value"]}
        rows={rows.map((r) => ({
          label: r.label,
          cells: [r.value === null ? null : format(r.value)],
        }))}
      />
    </div>
  );
}
