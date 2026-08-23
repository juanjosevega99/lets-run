import { esc } from "../html.js";
import { EASY_SHARE_TARGET, type HrBand } from "../../deterministic/zones.js";
import { totalSeconds, zonePaceSecPerKm, zoneShare, type ZoneTotals } from "../../deterministic/zoneTime.js";
import type { ZoneReport } from "../queries.js";

export interface ZonesData {
  report: ZoneReport | null;
  tz: string;
}

export function renderZones(d: ZonesData): string {
  const r = d.report;
  if (!r) {
    return `
  <header class="page-head">
    <div><p class="eyebrow">Effort</p><h1>Your zones</h1></div>
  </header>
  <section class="panel" style="padding:1.4rem"><p class="empty">No heart-rate data yet. Use <strong>Update training</strong> after importing activities with a heart-rate stream.</p></section>`;
  }

  const easyPace = zonePaceSecPerKm(r.combined, "easy");
  const easyBand = r.bands.find((b) => b.key === "easy")!;

  return `
  <header class="page-head">
    <div><p class="eyebrow">Effort</p><h1>Your zones</h1></div>
    <p class="section-copy">Computed from your own heart-rate streams, not an age formula. These update every time you press Update training.</p>
  </header>

  <div class="zone-answer panel">
    <div class="zone-answer-cell">
      <div class="k">Run easy runs at</div>
      <div class="zone-answer-v">${easyPace != null ? esc(paceLabel(easyPace)) : "—"}</div>
      <p>${
        r.medianEasyRunPaceSecPerKm != null
          ? `Median of your easy-HR runs: ${esc(paceLabel(r.medianEasyRunPaceSecPerKm))}`
          : "Not enough easy running yet to measure a pace."
      }</p>
    </div>
    <div class="zone-answer-cell zone-answer-cell--accent">
      <div class="k">Keep heart rate under</div>
      <div class="zone-answer-v">${easyBand.max} <span class="zone-unit">bpm</span></div>
      <p>Easy band ${easyBand.min}–${easyBand.max} bpm · max HR ${r.hrMax}</p>
    </div>
  </div>
  <p class="freshness">Pace is the output; heart rate is the instruction. If HR drifts over ${easyBand.max} late in a run, slow down or walk rather than holding the pace.</p>

  <section class="section-block" aria-labelledby="ladder-heading">
    <div class="section-heading">
      <div><p class="eyebrow">Max HR ${r.hrMax}</p><h2 id="ladder-heading">The four gears</h2></div>
      <p class="section-copy">Paces are what you actually ran at each heart rate across your last ${r.runs.length} runs — they get faster at the same HR as your base rebuilds.</p>
    </div>
    <div class="ladder">${r.bands.map((b) => renderBand(b, r.combined)).join("")}</div>
    ${oneGearNote(r.combined)}
  </section>

  ${renderEasyShare(r)}`;
}

function renderBand(b: HrBand, combined: ZoneTotals): string {
  // No pace for the recovery band. Heart rate lags effort by a minute or two, so the
  // samples below the easy floor are mostly the first minutes of a run — already at
  // running speed while HR catches up. Reporting that as a "recovery pace" produces the
  // nonsense of a recovery pace FASTER than the easy pace.
  const pace = b.key === "recovery" ? null : zonePaceSecPerKm(combined, b.key);
  const range = b.max == null ? `${b.min}+` : b.min === 0 ? `under ${b.max}` : `${b.min}–${b.max}`;
  const isEasy = b.key === "easy";
  return `<article class="zone-row zone-row--${b.key}${isEasy ? " zone-row--target" : ""}">
    <span class="zone-accent" aria-hidden="true"></span>
    <div class="zone-main">
      <h3>${esc(b.label)}${isEasy ? `<span class="pill pill--accent zone-tag">Your zone</span>` : ""}</h3>
      <p>${esc(b.purpose)}</p>
    </div>
    <div class="zone-nums">
      <strong>${esc(range)}</strong>
      <span>${pace != null ? esc(paceLabel(pace)) : "—"}</span>
    </div>
  </article>`;
}

/**
 * One number instead of a per-run chart. The full per-run distribution is computed
 * (and drives the zone paces above) but is not rendered: six stacked bars cost a lot of
 * screen for a single decision, and the decision is only ever "is enough of my running
 * easy?" — so show that share and the target, and nothing else.
 */
function renderEasyShare(r: ZoneReport): string {
  if (totalSeconds(r.combined) <= 0) return "";
  const share = zoneShare(r.combined, "easy");
  const pct = Math.round(share * 100);
  const target = Math.round(EASY_SHARE_TARGET * 100);
  const onTrack = share >= EASY_SHARE_TARGET;
  return `
  <section class="section-block" aria-labelledby="easy-share-heading">
    <div class="section-heading">
      <div><p class="eyebrow">Last ${r.runs.length} runs</p><h2 id="easy-share-heading">How much of your running is easy</h2></div>
    </div>
    <article class="insight-card panel readiness-card ${onTrack ? "tone-calm" : "tone-warn"}">
      <div class="k">Time spent in the easy band</div>
      <div class="v">${pct}<span class="zone-unit">% · target ${target}%</span></div>
      <p>${esc(easyVerdict(share))}</p>
    </article>
    ${renderEasyShareTrend(r)}
  </section>`;
}

/**
 * Per-run easy share over time — the one thing worth plotting here. The per-run zone
 * BREAKDOWN is noise (six stacked bars to answer one question), but its trend is signal:
 * it says whether the grey-zone habit is actually improving. Deliberately drawn as
 * discrete per-run bars with no trendline: at this sample size a fitted slope would
 * imply more certainty than six runs support.
 */
function renderEasyShareTrend(r: ZoneReport): string {
  const points = [...r.runs]
    .reverse() // queries return newest-first; read left-to-right in time
    .map((run) => ({ date: run.startDate, share: zoneShare(run.totals, "easy") }))
    .filter((p) => p.share > 0);
  if (points.length < 3) return "";

  const W = 640;
  const H = 186;
  const left = 34;
  const right = 12;
  const top = 18;
  const base = 140;
  const span = W - left - right;
  const plotH = base - top;
  const slot = span / points.length;
  const barW = Math.min(34, slot * 0.58);
  const targetY = base - EASY_SHARE_TARGET * plotH;

  const bars = points
    .map((p, i) => {
      const x = left + slot * i + (slot - barW) / 2;
      const h = Math.max(1, p.share * plotH);
      const hit = p.share >= EASY_SHARE_TARGET;
      return `<rect class="zone-trend-bar${hit ? " zone-trend-bar--hit" : ""}" x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3"><title>${esc(monthDay(p.date))}: ${Math.round(p.share * 100)}% easy</title></rect>`;
    })
    .join("");

  const labels = points
    .map((p, i) => {
      // Label the ends and every other point between, so a phone doesn't collide them.
      if (i !== 0 && i !== points.length - 1 && i % 2 !== 0) return "";
      const x = left + slot * i + slot / 2;
      return `<text class="zone-trend-tick" x="${x.toFixed(1)}" y="${base + 18}" text-anchor="middle">${esc(monthDay(p.date))}</text>`;
    })
    .join("");

  return `<div class="zone-trend panel">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Easy share for the last ${points.length} runs: ${points.map((p) => `${monthDay(p.date)} ${Math.round(p.share * 100)}%`).join(", ")}.">
      <line class="zone-trend-target" x1="${left}" y1="${targetY.toFixed(1)}" x2="${W - right}" y2="${targetY.toFixed(1)}"></line>
      <text class="zone-trend-tick" x="${left - 6}" y="${(targetY + 4).toFixed(1)}" text-anchor="end">${Math.round(EASY_SHARE_TARGET * 100)}%</text>
      <line class="zone-trend-axis" x1="${left}" y1="${base}" x2="${W - right}" y2="${base}"></line>
      ${bars}
      ${labels}
      <text class="zone-trend-tick" x="${W / 2}" y="${H - 6}" text-anchor="middle">share of each run spent in the easy band</text>
    </svg>
  </div>`;
}

function monthDay(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(d);
}

/** Below this gap, easy and moderate pace are effectively the same pace. */
const ONE_GEAR_GAP_SEC_PER_KM = 20;

/**
 * When easy and moderate pace are nearly identical, the zones are NOT separated by
 * speed — the athlete runs one pace and heart rate climbs underneath it (cardiac
 * drift). Saying so prevents the obvious misreading of the ladder above ("why would I
 * run the same pace in two different zones?").
 */
function oneGearNote(combined: ZoneTotals): string {
  const easy = zonePaceSecPerKm(combined, "easy");
  const moderate = zonePaceSecPerKm(combined, "moderate");
  if (easy == null || moderate == null) return "";
  if (Math.abs(easy - moderate) > ONE_GEAR_GAP_SEC_PER_KM) return "";
  return `<p class="freshness">Your easy and moderate paces are almost the same, which means these zones are not separated by speed right now: you run one pace and your heart rate climbs underneath it as the run goes on. Holding the easy runs slower — and letting them get slower still as they progress — is what separates the gears again.</p>`;
}

/**
 * The polarized-training read. States the number and the target rather than a verdict
 * alone, so the athlete can see how far off it is.
 */
function easyVerdict(easyShare: number): string {
  const target = Math.round(EASY_SHARE_TARGET * 100);
  if (easyShare >= EASY_SHARE_TARGET) {
    return `At or above the ~${target}% that base building wants. Keep it there.`;
  }
  return `The gap is time spent in the moderate "grey zone" — tiring without building much base. Slowing the easy runs down is the single biggest lever right now.`;
}

function paceLabel(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${s === 60 ? m + 1 : m}:${String(s === 60 ? 0 : s).padStart(2, "0")}/km`;
}
