import { esc } from "./html.js";

/** Small, dependency-free SVG bar chart for weekly running volume. */
export interface BarChartInput {
  bars: { label: string; value: number }[];
  refLine?: { value: number; label: string };
  valueUnit: string;
  width?: number;
  height?: number;
}

export function barChart(input: BarChartInput): string {
  const width = input.width ?? 720;
  const height = input.height ?? 250;
  const padL = 42;
  const padB = 28;
  const padT = 24;
  const padR = 12;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  if (input.bars.length === 0) {
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="no data for running volume"><text class="chart-label" x="${width / 2}" y="${height / 2}" text-anchor="middle">No running data yet</text></svg>`;
  }

  const maxValue = Math.max(...input.bars.map((b) => b.value), input.refLine?.value ?? 0, 1);
  const barW = plotW / input.bars.length;
  const y = (v: number) => padT + plotH * (1 - v / maxValue);

  const grid = [0, 0.5, 1]
    .map((ratio) => {
      const value = maxValue * ratio;
      const lineY = y(value);
      return `<line class="chart-grid" x1="${padL}" y1="${lineY.toFixed(1)}" x2="${width - padR}" y2="${lineY.toFixed(1)}"/><text class="chart-label" x="${padL - 8}" y="${(lineY + 3).toFixed(1)}" text-anchor="end">${value.toFixed(0)}</text>`;
    })
    .join("");

  const bars = input.bars
    .map((b, i) => {
      const h = (b.value / maxValue) * plotH;
      const x = padL + i * barW;
      const latest = i === input.bars.length - 1 ? " chart-bar--latest" : "";
      return `<rect class="chart-bar${latest}" x="${(x + barW * 0.14).toFixed(1)}" y="${(padT + plotH - h).toFixed(1)}" width="${(barW * 0.72).toFixed(1)}" height="${h.toFixed(1)}" rx="4"><title>${esc(b.label)}: ${b.value.toFixed(1)} ${esc(input.valueUnit)}</title></rect>`;
    })
    .join("");

  const step = Math.max(1, Math.ceil(input.bars.length / 6));
  const lastIndex = input.bars.length - 1;
  const labels = input.bars
    .map((b, i) =>
      i === lastIndex || (i % step === 0 && i < lastIndex - step / 2)
        ? `<text class="chart-label" x="${(padL + i * barW + barW / 2).toFixed(1)}" y="${height - 7}" text-anchor="middle">${esc(b.label)}</text>`
        : "",
    )
    .join("");

  const ref = input.refLine
    ? `<line class="chart-ref" x1="${padL}" y1="${y(input.refLine.value).toFixed(1)}" x2="${width - padR}" y2="${y(input.refLine.value).toFixed(1)}" stroke-dasharray="6 5"/>
<text class="chart-ref-label" x="${width - padR}" y="${(y(input.refLine.value) - 7).toFixed(1)}" text-anchor="end">${esc(input.refLine.label)}</text>`
    : "";

  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Weekly running volume in ${esc(input.valueUnit)}">${grid}${bars}${ref}${labels}</svg>`;
}
