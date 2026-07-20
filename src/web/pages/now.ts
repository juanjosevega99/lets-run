import { esc } from "../html.js";
import { dateInTimeZone, formatDuration, formatPace } from "../../lib/time.js";
import { RACE } from "../../lib/race.js";
import type { FitnessRow, PlanRow, PredictionRow, RaceRow, RecentSnapshot } from "../queries.js";

export interface NowData {
  daysToRace: number;
  latestPrediction: PredictionRow | null;
  fitness: FitnessRow | null;
  snapshot: RecentSnapshot;
  latestActivityDate: Date | null;
  races: RaceRow[];
  plan: PlanRow | null;
  now: Date;
  tz: string;
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function renderNow(d: NowData): string {
  const p = d.latestPrediction;
  const gapS = p ? p.predictedTimeS - RACE.targetTimeS : null;
  const gapLabel =
    gapS == null
      ? "Waiting for a fresh signal"
      : gapS <= 0
        ? `${formatDuration(-gapS)} ahead of target`
        : `${formatDuration(gapS)} to close`;
  const plan = summarizePlan(d.plan, d.now, d.tz);
  const s = d.snapshot;
  const strength = sumSports(s, (sport) => /weight|strength|gym/.test(sport));
  const aerobicSupport = sumSports(s, (sport) => /ride|cycl|swim|row|elliptical|walk|hike/.test(sport));
  const freshness = d.latestActivityDate
    ? `Training data through ${esc(dateInTimeZone(d.latestActivityDate, d.tz))}`
    : "No activities have been imported yet";

  return `
  <section class="overview-hero panel" aria-labelledby="race-title">
    <div class="hero-copy">
      <div>
        <p class="hero-kicker">Goal race · ${esc(RACE.bracket)}</p>
        <h1 id="race-title">${esc(RACE.name)}</h1>
        <p class="hero-meta">${formatIsoDate(RACE.dateIso, { month: "long", day: "numeric", year: "numeric" })} · Torres del Paine</p>
      </div>
      <div class="countdown"><strong>${d.daysToRace}</strong><span>days to race</span></div>
    </div>
    <aside class="goal-card" aria-label="Race goal and current shape">
      <p class="eyebrow">Winning target</p>
      <div class="goal-time">${formatDuration(RACE.targetTimeS)}</div>
      <div class="goal-label">${formatPace(RACE.distanceM, RACE.targetTimeS)} average pace</div>
      <div class="hero-metrics">
        <div class="hero-metric"><span>Estimated Huemul 21K today</span><strong>${p ? formatDuration(p.predictedTimeS) : "Not enough recent running"}</strong>${p && s.runs === 0 ? `<small>Low recent-running signal</small>` : ""}</div>
        <div class="hero-metric"><span>Gap</span><strong>${gapLabel}</strong></div>
        <div class="hero-metric"><span>Current focus</span><strong>${esc(plan.phase)}</strong></div>
      </div>
    </aside>
  </section>

  <section aria-labelledby="next-heading">
    <div class="section-heading">
      <div><p class="eyebrow">Coach’s call</p><h2 id="next-heading">The next useful step</h2></div>
      <p class="section-copy">Build the running signal calmly. The plan will earn complexity as consistency returns.</p>
    </div>
    <div class="coach-grid">
      ${renderNextRun(plan)}
      ${renderWeekGlance(plan)}
    </div>
  </section>

  <section class="section-block" aria-labelledby="context-heading">
    <div class="section-heading">
      <div><p class="eyebrow">Recent context</p><h2 id="context-heading">What the last ${s.days} days say</h2></div>
      <p class="section-copy">Running, aerobic support, and strength stay visible as separate signals.</p>
    </div>
    <div class="insight-grid">
      <article class="insight-card panel">
        <div class="k">Running consistency</div>
        <div class="v">${s.runs} ${s.runs === 1 ? "run" : "runs"}</div>
        <p>${s.runs > 0 ? `${s.runKm.toFixed(1)} km · ${formatDuration(s.runTimeS)} total${s.longestRunKm != null ? ` · ${s.longestRunKm.toFixed(1)} km longest` : ""}` : "Rebuild starts with the first easy run."}</p>
      </article>
      <article class="insight-card panel">
        <div class="k">Aerobic support</div>
        <div class="v">${aerobicSupport.count} ${aerobicSupport.count === 1 ? "session" : "sessions"}</div>
        <p>${aerobicSupport.count > 0 ? `${aerobicSupport.km.toFixed(1)} km logged outside running.` : "No cycling, swimming, or similar work logged."}</p>
      </article>
      <article class="insight-card panel">
        <div class="k">Strength work</div>
        <div class="v">${strength.count} ${strength.count === 1 ? "session" : "sessions"}</div>
        <p>Shown alongside the plan as training context, separate from running volume.</p>
      </article>
    </div>
    ${s.runs === 0 ? `<p class="empty" style="margin-top:1rem"><strong>You’re rebuilding running consistency.</strong> The next useful signal is completing the first easy run—not forcing intensity.</p>` : ""}
    <p class="freshness">${freshness}</p>
  </section>

  ${renderLoadDetails(d.fitness)}
  ${renderRaceDetails(d)}
  `;
}

interface PlanSummary {
  phase: string;
  plan: PlanRow | null;
  nextRun: (PlanRow["keySession"] & { isKey: boolean; dateIso: string }) | null;
  runCount: number;
  runMinutes: number;
  runKm: number;
  qualityCount: number;
  restDay: string | null;
}

function summarizePlan(plan: PlanRow | null, now: Date, tz: string): PlanSummary {
  if (!plan) {
    return { phase: "Rebuild running consistency", plan: null, nextRun: null, runCount: 0, runMinutes: 0, runKm: 0, qualityCount: 0, restDay: null };
  }
  const sessions = [
    { ...plan.keySession, isKey: true },
    ...plan.supportSessions.map((session) => ({ ...session, isKey: false })),
  ].sort((a, b) => a.day - b.day);
  const runs = sessions.filter(isRunSession);
  const today = dateInTimeZone(now, tz);
  const nextRun = runs
    .map((session) => ({ ...session, dateIso: addIsoDays(plan.weekStart, session.day) }))
    .find((session) => session.dateIso >= today) ?? null;
  const rest = sessions.find((session) => session.intensity === "rest");
  return {
    phase: friendlyPhase(plan),
    plan,
    nextRun,
    runCount: runs.length,
    runMinutes: runs.reduce((sum, session) => sum + (session.planned_minutes ?? 0), 0),
    runKm: runs.reduce((sum, session) => sum + (session.planned_km ?? 0), 0),
    qualityCount: runs.filter((session) => session.intensity === "high").length,
    restDay: rest ? DAY_NAMES[rest.day] ?? null : null,
  };
}

function renderNextRun(summary: PlanSummary): string {
  if (!summary.plan) {
    return `<article class="next-session panel"><p class="eyebrow">Next run</p><p class="empty">No plan is available yet. Use <strong>Update training</strong> to build the next week.</p></article>`;
  }
  const run = summary.nextRun;
  if (!run) {
    return `<article class="next-session panel"><p class="eyebrow">Next run</p><h3 class="session-title">This plan week is complete</h3><p class="session-description">Update training when the week closes and the coach will prepare the next block.</p></article>`;
  }
  const dose = run.planned_minutes != null ? `${run.planned_minutes} min` : run.planned_km > 0 ? `${run.planned_km.toFixed(1)} km` : "Easy by feel";
  return `<article class="next-session panel">
    <div class="session-topline"><span class="session-date">${formatIsoDate(run.dateIso, { weekday: "long", month: "short", day: "numeric" })}</span><span class="pill ${run.isKey ? "pill--accent" : ""}">${run.isKey ? "Key run" : intensityLabel(run.intensity)}</span></div>
    <h3 class="session-title">${esc(run.title)}</h3>
    <p class="session-description">${esc(run.description)}</p>
    <div class="session-dose">${dose}</div>
    <span class="sub">${intensityLabel(run.intensity)} effort</span>
  </article>`;
}

function renderWeekGlance(summary: PlanSummary): string {
  const volume = summary.runMinutes > 0 ? `${summary.runMinutes} min` : summary.runKm > 0 ? `${summary.runKm.toFixed(1)} km` : "—";
  return `<aside class="week-glance panel">
    <div class="panel-topline"><div><p class="eyebrow">This plan</p><h3>${summary.plan ? formatWeekRange(summary.plan.weekStart) : "Not generated"}</h3></div><span class="pill">${esc(summary.phase)}</span></div>
    <div class="glance-list">
      <div class="glance-item"><span>Running</span><strong>${summary.runCount} ${summary.runCount === 1 ? "run" : "runs"}</strong></div>
      <div class="glance-item"><span>Planned volume</span><strong>${volume}</strong></div>
      <div class="glance-item"><span>Intensity</span><strong>${summary.qualityCount > 0 ? `${summary.qualityCount} quality session${summary.qualityCount === 1 ? "" : "s"}` : "All easy"}</strong></div>
      <div class="glance-item"><span>Protected recovery</span><strong>${summary.restDay ?? "As needed"}</strong></div>
    </div>
  </aside>`;
}

function renderLoadDetails(fitness: FitnessRow | null): string {
  if (!fitness) {
    return `<details class="details-panel section-block"><summary>Training-load model</summary><div class="details-body"><p class="empty">No load state yet. Use <strong>Update training</strong> after importing activities.</p></div></details>`;
  }
  const values = [
    [fitness.ctl, "Running chronic load"],
    [fitness.atl, "Running acute load"],
    [fitness.tsb, "Running load balance"],
    [fitness.aerobicCtl, "Aerobic chronic load"],
    [fitness.totalAtl, "Whole-program acute load"],
    [fitness.totalTsb, "Whole-program balance"],
  ];
  return `<details class="details-panel section-block">
    <summary>Training-load model</summary>
    <div class="details-body">
      <p class="sub">Experimental workload indices as of ${esc(fitness.day)}. They are planning context—not direct measurements of fitness, fatigue, or readiness.</p>
      <div class="technical-grid">${values.map(([value, label]) => `<div class="technical-value"><strong>${typeof value === "number" ? value.toFixed(1) : "—"}</strong><span>${label}</span></div>`).join("")}</div>
    </div>
  </details>`;
}

function renderRaceDetails(d: NowData): string {
  const benchmarks = RACE.benchmarks2026
    .map((b) => `<tr><td>${esc(b.label)}</td><td class="num">${formatDuration(b.timeS)}</td><td class="num">${formatPace(RACE.distanceM, b.timeS) ?? ""}</td></tr>`)
    .join("");
  const raceRows = d.races
    .map((race) => `<tr><td>${esc(race.raceDate)}</td><td>${esc(race.name)}</td><td class="num">${race.distanceKm.toFixed(1)}</td><td class="num">${formatDuration(race.officialTimeS)}</td><td>${esc(race.terrain)}</td></tr>`)
    .join("");
  const p = d.latestPrediction;
  const estimate = p
    ? `<p class="sub">Estimated Huemul 21K time if raced on ${esc(dateInTimeZone(p.predictedAt, d.tz))}: <strong>${formatDuration(p.predictedTimeS)}</strong>${p.intervalP10S != null && p.intervalP90S != null ? ` · historical error range ${formatDuration(p.intervalP10S)}–${formatDuration(p.intervalP90S)}${p.intervalSampleSize != null ? ` (n=${p.intervalSampleSize})` : ""}` : ""} · model <code>${esc(p.predictor)}</code>. ${d.snapshot.runs === 0 ? "There is no recent running signal, so treat this as a rough baseline. " : ""}This is not a race-day forecast. Body-weight history is not yet tracked or used by this estimate.</p>`
    : `<p class="sub">The current-shape estimate will appear when there is enough usable running data. The plan remains conservative until then.</p>`;
  return `<details class="details-panel section-block">
    <summary>Estimate and race references</summary>
    <div class="details-body">
      ${estimate}
      <h3>2026 Patagonia benchmarks</h3>
      <div class="table-wrap"><table><thead><tr><th>Result</th><th class="num">Time</th><th class="num">Pace</th></tr></thead><tbody>${benchmarks}</tbody></table></div>
      <h3 style="margin-top:1.4rem">Personal race history (${d.races.length})</h3>
      ${raceRows ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Race</th><th class="num">Km</th><th class="num">Time</th><th>Terrain</th></tr></thead><tbody>${raceRows}</tbody></table></div>` : `<p class="empty">No race history imported yet.</p>`}
    </div>
  </details>`;
}

function friendlyPhase(plan: PlanRow): string {
  if (/return[_ -]?to[_ -]?run(?:ning)?/i.test(plan.explanation ?? "")) return "Return to running";
  const labels: Record<string, string> = {
    aerobic_base: "Rebuild running consistency",
    durability: "Build durability",
    threshold: "Develop threshold",
    speed: "Develop speed",
  };
  return labels[plan.targetLimiter ?? ""] ?? "Build toward race day";
}

function intensityLabel(intensity: string): string {
  return intensity === "high" ? "Quality" : intensity === "rest" ? "Rest" : "Easy";
}

function isRunSession(session: PlanRow["keySession"]): boolean {
  if (session.intensity === "rest" || isStrengthSession(session)) return false;
  return session.planned_km > 0 || /\brun(?:ning)?\b/i.test(session.title);
}

function isStrengthSession(session: PlanRow["keySession"]): boolean {
  return /strength|weight|gym|lift/i.test(session.title);
}

function sumSports(snapshot: RecentSnapshot, match: (normalizedSport: string) => boolean): { count: number; km: number } {
  return snapshot.bySport.reduce(
    (total, sport) => match(sport.sport.toLowerCase()) ? { count: total.count + sport.count, km: total.km + sport.km } : total,
    { count: 0, km: 0 },
  );
}

function addIsoDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatIsoDate(iso: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

function formatWeekRange(weekStart: string): string {
  const end = addIsoDays(weekStart, 6);
  const startDate = new Date(`${weekStart}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const start = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(startDate);
  const finish = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "UTC" }).format(endDate);
  return `${start}–${finish}`;
}
