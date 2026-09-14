import { barChart } from "../svg.js";
import { dateInTimeZone, formatDuration } from "../../lib/time.js";
import { esc } from "../html.js";
import { RACE } from "../../lib/race.js";
import type { PredictionRow, WeekVolume } from "../queries.js";
import type { Trajectory } from "../../deterministic/trajectory.js";

export interface TrajectoryData {
  weeks: WeekVolume[];
  peakAvgKm: number | null;
  predictions: PredictionRow[];
  trajectory: Trajectory | null;
  tz: string;
}

const STATUS_LABELS: Record<Trajectory["status"], string> = {
  no_baseline: "No baseline yet",
  taper: "Tapering",
  arrived: "At race volume",
  on_track: "On track",
  tight: "Tight",
  at_risk: "At risk",
  unreachable: "Out of reach",
};

/**
 * The forward half of the page. Everything above it describes what has happened; this
 * says what the race still requires — and, most usefully, how many whole weeks can
 * still be missed before the goal itself has to change.
 */
function renderRequired(t: Trajectory | null): string {
  if (t == null) return "";
  const pct = (value: number | null) => (value == null ? "—" : `+${(value * 100).toFixed(1)}%`);
  const slack =
    t.slackWeeks == null
      ? "—"
      : t.slackWeeks <= 0
        ? "None left"
        : `${t.slackWeeks} ${t.slackWeeks === 1 ? "week" : "weeks"}`;
  return `
  <section class="section-block" aria-labelledby="required-heading">
    <div class="section-heading">
      <div><p class="eyebrow">What the race still asks</p><h2 id="required-heading">Required trajectory</h2></div>
      <p class="section-copy">Worked backwards from race day, excluding the taper and one down week in four. Growth is compounding, so the rate matters more than any single week.</p>
    </div>
    <article class="chart-panel panel">
      <div class="plan-summary" aria-label="Required trajectory">
        <span class="pill${t.status === "on_track" || t.status === "arrived" ? "" : " pill--accent"}">${esc(STATUS_LABELS[t.status])}</span>
        <span class="pill">Weekly volume · ${pct(t.requiredWeeklyGrowth)}/wk</span>
        <span class="pill">Long run · ${pct(t.requiredLongRunGrowth)}/wk</span>
        <span class="pill pill--muted">Target · ${t.peakWeeklyKm.toFixed(0)} km/wk with a ${t.peakLongRunKm.toFixed(0)} km long run</span>
        <span class="pill${t.slackWeeks != null && t.slackWeeks < 2 ? " pill--accent" : " pill--muted"}">Weeks you can still miss · ${slack}</span>
      </div>
      <p class="sub" style="margin:1rem 0 0">${esc(t.headline)}</p>
    </article>
  </section>`;
}

export function renderTrajectory(d: TrajectoryData): string {
  const visibleWeeks = d.weeks.slice(-12);
  const currentWeek = visibleWeeks.at(-1) ?? null;
  const completedWeeks = visibleWeeks.slice(0, -1).slice(-4);
  const fourWeekAvg = completedWeeks.length > 0 ? completedWeeks.reduce((sum, week) => sum + week.km, 0) / completedWeeks.length : null;
  const latest = d.predictions.at(-1) ?? null;
  const latestPrediction = latest != null && latest.reliable ? latest : null;
  const gapS = latestPrediction ? latestPrediction.predictedTimeS - RACE.targetTimeS : null;
  const chart = barChart({
    bars: visibleWeeks.map((week) => ({ label: week.weekStart.slice(5), value: week.km })),
    refLine: d.peakAvgKm != null ? { value: d.peakAvgKm, label: `Peak-era avg ${d.peakAvgKm.toFixed(0)} km/wk` } : undefined,
    valueUnit: "km",
  });

  return `
  <header class="page-head">
    <div><p class="eyebrow">Race build</p><h1>Progress</h1></div>
    <p class="section-copy">The useful trend is consistency over months—not one heroic week or one noisy estimate.</p>
  </header>

  <section class="goal-strip panel" aria-label="Goal and current shape">
    <div class="goal-copy"><p class="eyebrow">Patagonia 21K</p><h2>Race-day north star</h2><p>${esc(RACE.bracket)} · ${esc(RACE.dateIso)}</p></div>
    <div class="compact-metric"><span>Goal</span><strong>${formatDuration(RACE.targetTimeS)}</strong></div>
    <div class="compact-metric"><span>Current shape</span><strong>${latestPrediction ? formatDuration(latestPrediction.predictedTimeS) : "—"}</strong></div>
    <div class="compact-metric"><span>Gap</span><strong>${gapS == null ? "Need recent runs" : gapS <= 0 ? `${formatDuration(-gapS)} ahead` : `${formatDuration(gapS)} to close`}</strong></div>
  </section>

  <section class="section-block" aria-labelledby="volume-heading">
    <div class="section-heading">
      <div><p class="eyebrow">12-week view</p><h2 id="volume-heading">Running consistency</h2></div>
      <p class="section-copy">Weekly running volume compared with the average active week from your 2021–22 peak era.</p>
    </div>
    <article class="chart-panel panel">
      <div class="plan-summary" aria-label="Volume summary">
        <span class="pill">This week · ${currentWeek ? `${currentWeek.km.toFixed(1)} km` : "—"}</span>
        <span class="pill">4 completed weeks · ${fourWeekAvg != null ? `${fourWeekAvg.toFixed(1)} km avg` : "—"}</span>
        <span class="pill pill--muted">Peak-era avg · ${d.peakAvgKm != null ? `${d.peakAvgKm.toFixed(1)} km` : "—"}</span>
      </div>
      <div class="chart-wrap" tabindex="0" aria-label="Scrollable 12-week running-volume chart">${chart}</div>
      <p class="sub" style="margin:1rem 0 0">Zero weeks remain visible. The reference line is context for a gradual rebuild, not next week’s prescription.</p>
    </article>
  </section>

  ${renderRequired(d.trajectory)}

  ${renderPredictionHistory(d.predictions, d.tz)}
  `;
}

function renderPredictionHistory(predictions: PredictionRow[], tz: string): string {
  const content = predictions.length === 0
    ? `<p class="empty">No estimate history yet. It will begin once recent running provides enough signal for a useful current-shape estimate.</p>`
    : `<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th class="num">Current shape</th><th class="num">Historical error range</th><th>Model</th></tr></thead>
      <tbody>${predictions
        .slice()
        .reverse()
        .map((prediction) => {
          const band = prediction.intervalP10S != null && prediction.intervalP90S != null
            ? `${formatDuration(prediction.intervalP10S)}–${formatDuration(prediction.intervalP90S)}`
            : "—";
          const shape = prediction.reliable ? formatDuration(prediction.predictedTimeS) : "Paused (no anchor)";
          return `<tr><td>${dateInTimeZone(prediction.predictedAt, tz)}</td><td class="num">${shape}</td><td class="num">${band}</td><td><code>${esc(prediction.predictor)}</code></td></tr>`;
        })
        .join("")}</tbody>
    </table></div>`;
  return `<details class="details-panel section-block"><summary>Current-shape estimate history</summary><div class="details-body">${content}<p class="sub" style="margin-top:.8rem">These estimates describe shape on each date; they are not race-day forecasts.</p></div></details>`;
}
