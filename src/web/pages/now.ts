import { esc } from "../html.js";
import { dateInTimeZone, formatDuration, formatPace } from "../../lib/time.js";
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
  tz: string;
}

export function renderNow(d: NowData): string {
  const benchmarks = RACE.benchmarks2026
    .map(
      (b) =>
        `<tr><td>${esc(b.label)}</td><td class="num">${formatDuration(b.timeS)}</td><td class="num">${formatPace(RACE.distanceM, b.timeS) ?? ""}</td></tr>`,
    )
    .join("");

  const prediction = d.latestPrediction
    ? predictionBlock(d.latestPrediction, d.tz)
    : `<p class="empty">No prediction yet. The predictor is the hand-written deterministic layer
       (F1) — once it exists and passes the F2 backtest, the current projected time and its
       P10–P90 band appear here, next to the gap to ${formatDuration(RACE.targetTimeS)}.</p>`;

  const s = d.snapshot;
  const freshness = d.latestActivityDate
    ? `${esc(dateInTimeZone(d.latestActivityDate, d.tz))} — press <strong>Sync &amp; replan</strong> above to pull newer training`
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

  <h2>Current-shape estimate</h2>
  ${prediction}

  <h2>Training load (Banister-style, experimental)</h2>
  ${
    d.fitness
      ? `<div class="cards">
    <div class="card"><div class="v">${d.fitness.ctl.toFixed(1)}</div><div class="k">chronic running load</div></div>
    <div class="card"><div class="v">${d.fitness.atl.toFixed(1)}</div><div class="k">acute running load</div></div>
    <div class="card"><div class="v">${d.fitness.tsb.toFixed(1)}</div><div class="k">running load balance</div></div>
    <div class="card"><div class="v">${d.fitness.aerobicCtl?.toFixed(1) ?? "—"}</div><div class="k">combined aerobic chronic load</div></div>
    <div class="card"><div class="v">${d.fitness.totalAtl?.toFixed(1) ?? "—"}</div><div class="k">acute whole-program load</div></div>
    <div class="card"><div class="v">${d.fitness.totalTsb?.toFixed(1) ?? "—"}</div><div class="k">whole-program load balance</div></div>
  </div>
  <p class="sub">as of ${esc(d.fitness.day)} · workload indices are coaching context, not direct measurements of fitness, fatigue, or readiness</p>`
      : `<p class="empty">No fitness state yet — press <strong>Sync &amp; replan</strong> above.</p>`
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

function predictionBlock(p: PredictionRow, tz: string): string {
  const gapS = p.predictedTimeS - RACE.targetTimeS;
  const gap =
    gapS <= 0
      ? `<strong>${formatDuration(-gapS)} under target</strong>`
      : `<strong>${formatDuration(gapS)} to close</strong> to ${formatDuration(RACE.targetTimeS)}`;
  const band =
    p.intervalP10S != null && p.intervalP90S != null
      ? ` <span class="sub">(${formatDuration(p.intervalP10S)} – ${formatDuration(p.intervalP90S)} historical model-error range${p.intervalSampleSize != null ? `, n=${p.intervalSampleSize}` : ""})</span>`
      : "";
  return `<p class="big">${formatDuration(p.predictedTimeS)}${band}</p>
  <p>${gap} · if raced at today's estimated shape; this is not a forecast for race day · model: <code>${esc(p.predictor)}</code> · ${esc(dateInTimeZone(p.predictedAt, tz))}</p>`;
}
