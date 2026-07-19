import { esc } from "../html.js";
import { formatDuration, formatPace, isoDate } from "../../lib/time.js";
import { RACE } from "../../lib/race.js";
import type { RecentSnapshot, RaceRow, PredictionRow, FitnessRow } from "../queries.js";

/**
 * PRD F-C screen 1, "Now": target + gap, prediction (honest empty state until F1/F2),
 * and a raw-data training snapshot. The five-second read: what am I chasing, what's
 * projected, what am I actually doing about it.
 */
export interface NowData {
  daysToRace: number;
  latestPrediction: PredictionRow | null;
  fitness: FitnessRow | null;
  snapshot: RecentSnapshot;
  latestActivityDate: Date | null;
  races: RaceRow[];
  now: Date;
}

export function renderNow(d: NowData): string {
  const benchmarks = RACE.benchmarks2026
    .map(
      (b) =>
        `<tr><td>${esc(b.label)}</td><td class="num">${formatDuration(b.timeS)}</td><td class="num">${formatPace(RACE.distanceM, b.timeS) ?? ""}</td></tr>`,
    )
    .join("");

  const prediction = d.latestPrediction
    ? predictionBlock(d.latestPrediction)
    : `<p class="empty">No prediction yet. The predictor is the hand-written deterministic layer
       (F1) — once it exists and passes the F2 backtest, the current projected time and its
       P10–P90 band appear here, next to the gap to ${formatDuration(RACE.targetTimeS)}.</p>`;

  const s = d.snapshot;
  const freshness = d.latestActivityDate
    ? `${esc(isoDate(d.latestActivityDate))} — sync newer training with <code>npm run strava:sync</code>`
    : "no activities ingested";

  const raceRows = d.races
    .map(
      (r) =>
        `<tr><td>${esc(r.raceDate)}</td><td>${esc(r.name)}</td><td class="num">${r.distanceKm.toFixed(1)}</td><td class="num">${formatDuration(r.officialTimeS)}</td><td>${esc(r.terrain)}</td></tr>`,
    )
    .join("");

  return `
  <h1>${esc(RACE.name)}</h1>
  <p class="sub">${esc(RACE.dateIso)} · Torres del Paine</p>
  <p class="big">${d.daysToRace} days</p>

  <div class="target">
    <strong>Target: win ${esc(RACE.bracket)} — go under ${formatDuration(RACE.targetTimeS)}</strong>
    <table>
      <thead><tr><th>2026 benchmark</th><th class="num">time</th><th class="num">pace</th></tr></thead>
      <tbody>${benchmarks}</tbody>
    </table>
    <p class="sub">Thin bracket, high variance — train for the time, not last year's field.</p>
  </div>

  <h2>Current prediction</h2>
  ${prediction}

  <h2>Fitness (Banister)</h2>
  ${
    d.fitness
      ? `<div class="cards">
    <div class="card"><div class="v">${d.fitness.ctl.toFixed(1)}</div><div class="k">CTL — running fitness</div></div>
    <div class="card"><div class="v">${d.fitness.atl.toFixed(1)}</div><div class="k">ATL — fatigue (all sports)</div></div>
    <div class="card"><div class="v">${d.fitness.tsb.toFixed(1)}</div><div class="k">TSB — form</div></div>
  </div>
  <p class="sub">as of ${esc(d.fitness.day)} · rebuild after each sync: <code>npm run fitness:rebuild</code></p>`
      : `<p class="empty">No fitness state yet — run <code>npm run fitness:rebuild</code>.</p>`
  }

  <h2>Last ${s.days} days — raw training</h2>
  <div class="cards">
    <div class="card"><div class="v">${s.runs}</div><div class="k">runs</div></div>
    <div class="card"><div class="v">${s.runKm.toFixed(1)} km</div><div class="k">running volume</div></div>
    <div class="card"><div class="v">${s.runs > 0 ? formatDuration(s.runTimeS) : "—"}</div><div class="k">running time</div></div>
    <div class="card"><div class="v">${s.longestRunKm != null ? `${s.longestRunKm.toFixed(1)} km` : "—"}</div><div class="k">longest run</div></div>
  </div>
  ${
    s.runs === 0
      ? `<p class="empty">Zero runs in the last ${s.days} days. The model roadmap doesn't matter
         more than this number — the ${d.daysToRace}-day clock only moves with training.</p>`
      : ""
  }
  <table>
    <thead><tr><th>all sports, last ${s.days}d</th><th class="num">sessions</th><th class="num">km</th></tr></thead>
    <tbody>${s.bySport
      .map(
        (x) =>
          `<tr><td>${esc(x.sport)}</td><td class="num">${x.count}</td><td class="num">${x.km > 0 ? x.km.toFixed(1) : ""}</td></tr>`,
      )
      .join("")}</tbody>
  </table>
  <p class="sub">latest ingested activity: ${freshness}</p>

  <h2>Backtest set (${d.races.length} races)</h2>
  <table>
    <thead><tr><th>date</th><th>race</th><th class="num">km</th><th class="num">time</th><th>terrain</th></tr></thead>
    <tbody>${raceRows}</tbody>
  </table>`;
}

function predictionBlock(p: PredictionRow): string {
  const gapS = p.predictedTimeS - RACE.targetTimeS;
  const gap =
    gapS <= 0
      ? `<strong>${formatDuration(-gapS)} under target</strong>`
      : `<strong>${formatDuration(gapS)} to close</strong> to ${formatDuration(RACE.targetTimeS)}`;
  const band =
    p.intervalP10S != null && p.intervalP90S != null
      ? ` <span class="sub">(${formatDuration(p.intervalP10S)} – ${formatDuration(p.intervalP90S)})</span>`
      : "";
  return `<p class="big">${formatDuration(p.predictedTimeS)}${band}</p>
  <p>${gap} · model: <code>${esc(p.predictor)}</code> · ${esc(isoDate(p.predictedAt))}</p>`;
}
