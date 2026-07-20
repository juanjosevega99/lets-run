import { barChart } from "../svg.js";
import { dateInTimeZone, formatDuration } from "../../lib/time.js";
import { esc } from "../html.js";
import { RACE } from "../../lib/race.js";
import type { WeekVolume, PredictionRow } from "../queries.js";

/**
 * PRD F-C screen 3, "Trajectory": weekly running volume vs the 2021-22 peak-era average
 * (the rebuild gap, visible), and predicted-time-over-time once live predictions exist.
 */
export interface TrajectoryData {
  weeks: WeekVolume[];
  peakAvgKm: number | null;
  predictions: PredictionRow[];
  tz: string;
}

export function renderTrajectory(d: TrajectoryData): string {
  const chart = barChart({
    bars: d.weeks.map((w) => ({ label: w.weekStart.slice(5), value: w.km })),
    refLine:
      d.peakAvgKm != null
        ? { value: d.peakAvgKm, label: `2021-22 avg ${d.peakAvgKm.toFixed(0)} km/wk` }
        : undefined,
    valueUnit: "km",
  });

  const predictions =
    d.predictions.length === 0
      ? `<p class="empty">Empty until F1 + F2 exist. Every live prediction lands in
         <code>prediction_log</code>; this chart then shows how the current-shape estimate
         moves relative to ${formatDuration(RACE.targetTimeS)}. It is not yet a race-day forecast.</p>`
      : `<table>
      <thead><tr><th>date</th><th class="num">current shape</th><th class="num">historical error range</th><th>model</th></tr></thead>
      <tbody>${d.predictions
        .map((p) => {
          const band =
            p.intervalP10S != null && p.intervalP90S != null
              ? `${formatDuration(p.intervalP10S)}–${formatDuration(p.intervalP90S)}`
              : "";
          return `<tr><td>${dateInTimeZone(p.predictedAt, d.tz)}</td><td class="num">${formatDuration(p.predictedTimeS)}</td><td class="num">${band}</td><td><code>${esc(p.predictor)}</code></td></tr>`;
        })
        .join("")}</tbody>
    </table>`;

  return `
  <h1>Trajectory</h1>

  <h2>Weekly running volume (last ${d.weeks.length} weeks)</h2>
  ${chart}
  <p class="sub">Dashed line = average running week across 2021-22, the era of the 1:38-1:40
  halves. The gap between the bars and that line is the rebuild, made visible.</p>

  <h2>Current-shape estimate over time</h2>
  ${predictions}`;
}
