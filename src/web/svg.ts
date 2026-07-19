import { esc } from "./html.js";

/**
 * Hand-rolled SVG bar chart — no chart library, per the no-framework rule.
 * Bars scale to the max of the data and the optional reference line, so the
 * reference (e.g. 2021-22 peak weekly average) is always visible.
 */
export interface BarChartInput {
  bars: { label: string; value: number }[];
  refLine?: { value: number; label: string };
  valueUnit: string;
  width?: number;
  height?: number;
}

export function barChart(input: BarChartInput): string {
  const width = input.width ?? 720;
  const height = input.height ?? 220;
  const padL = 34;
  const padB = 22;
  const padT = 14;
  const plotW = width - padL - 8;
  const plotH = height - padT - padB;

  if (input.bars.length === 0) {
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="empty chart"><text x="${width / 2}" y="${height / 2}" text-anchor="middle" opacity="0.6" font-size="13">no data</text></svg>`;
  }

  const maxValue = Math.max(...input.bars.map((b) => b.value), input.refLine?.value ?? 0, 1);
  const barW = plotW / input.bars.length;
  const y = (v: number) => padT + plotH * (1 - v / maxValue);

  const bars = input.bars
    .map((b, i) => {
      const h = (b.value / maxValue) * plotH;
      const x = padL + i * barW;
      return `<rect x="${(x + barW * 0.1).toFixed(1)}" y="${(padT + plotH - h).toFixed(1)}" width="${(barW * 0.8).toFixed(1)}" height="${h.toFixed(1)}" fill="seagreen" opacity="0.85"><title>${esc(b.label)}: ${b.value.toFixed(1)} ${esc(input.valueUnit)}</title></rect>`;
    })
    .join("");

  // x labels: at most ~8, evenly spaced
  const step = Math.max(1, Math.ceil(input.bars.length / 8));
  const labels = input.bars
    .map((b, i) =>
      i % step === 0
        ? `<text x="${(padL + i * barW + barW / 2).toFixed(1)}" y="${height - 6}" text-anchor="middle" font-size="10" opacity="0.6">${esc(b.label)}</text>`
        : "",
    )
    .join("");

  const axis = `<text x="2" y="${y(maxValue) + 4}" font-size="10" opacity="0.6">${maxValue.toFixed(0)}</text>
<text x="2" y="${padT + plotH}" font-size="10" opacity="0.6">0</text>`;

  const ref = input.refLine
    ? `<line x1="${padL}" y1="${y(input.refLine.value).toFixed(1)}" x2="${width - 8}" y2="${y(input.refLine.value).toFixed(1)}" stroke="currentColor" stroke-dasharray="5 4" opacity="0.55"/>
<text x="${width - 8}" y="${(y(input.refLine.value) - 5).toFixed(1)}" text-anchor="end" font-size="10" opacity="0.75">${esc(input.refLine.label)}</text>`
    : "";

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="bar chart (${esc(input.valueUnit)})">${bars}${ref}${axis}${labels}</svg>`;
}
