import { esc } from "../html.js";
import { formatDuration, formatPace } from "../../lib/time.js";
import type { LoggedActivity, PlanRow, PlanSessionRow } from "../queries.js";

export interface WeekData {
  activities: LoggedActivity[];
  plan: PlanRow | null;
  tz: string;
}

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function renderWeek(d: WeekData): string {
  const summary = d.plan ? planSummary(d.plan) : null;
  return `
  <header class="page-head">
    <div><p class="eyebrow">Adaptive plan</p><h1>Your week</h1></div>
    <p class="section-copy">${d.plan ? `${formatWeekRange(d.plan.weekStart)} · ${esc(friendlyPhase(d.plan))}` : "A practical schedule built from your latest training."}</p>
  </header>

  ${
    d.plan && summary
      ? `<div class="plan-summary" aria-label="Plan summary">
          <span class="pill">${summary.runCount} ${summary.runCount === 1 ? "run" : "runs"}</span>
          <span class="pill">${summary.runDose}</span>
          <span class="pill">${summary.intensity}</span>
          ${summary.strengthCount > 0 ? `<span class="pill pill--muted">${summary.strengthCount} strength</span>` : ""}
        </div>

        <section class="section-block" aria-labelledby="schedule-heading">
          <div class="section-heading"><div><p class="eyebrow">${formatWeekRange(d.plan.weekStart)}</p><h2 id="schedule-heading">Daily schedule</h2></div><p class="section-copy">Running and strength are visually separated so the week is easy to scan.</p></div>
          ${renderPlan(d.plan)}
        </section>`
      : `<section class="panel" style="padding:1.4rem"><p class="empty">No plan is available yet. Use <strong>Update training</strong> to create the next week after your activities are current.</p></section>`
  }

  <section class="section-block" aria-labelledby="logged-heading">
    <div class="section-heading"><div><p class="eyebrow">Actual work</p><h2 id="logged-heading">Logged in this plan week</h2></div><p class="section-copy">The coach compares completed work with the prescription before building the next week.</p></div>
    ${renderLogged(d.activities, d.tz)}
  </section>`;
}

function renderPlan(plan: PlanRow): string {
  const sessions = [
    { ...plan.keySession, isKey: true },
    ...plan.supportSessions.map((session) => ({ ...session, isKey: false })),
  ].sort((a, b) => a.day - b.day);
  const byDay = Array.from({ length: 7 }, (_, day) => sessions.filter((session) => session.day === day));
  const days = byDay
    .map((daySessions, day) => {
      const isKeyDay = daySessions.some((session) => session.isKey);
      return `<article class="day-card${isKeyDay ? " day-card--key" : ""}">
        <span class="day-name">${DAY_NAMES[day]}</span>
        <span class="day-date">${formatDayDate(addIsoDays(plan.weekStart, day))}</span>
        ${
          daySessions.length > 0
            ? `<div class="day-sessions">${daySessions.map(renderSession).join("")}</div>`
            : `<p class="open-day">Open day · recovery or normal daily movement</p>`
        }
      </article>`;
    })
    .join("");

  return `<div class="schedule-grid">${days}</div>
    <aside class="coach-note panel">
      <div class="coach-note-icon" aria-hidden="true">C</div>
      <div><h3>Why this week looks like this</h3><p>${esc(friendlyExplanation(plan))}</p></div>
    </aside>`;
}

function renderSession(session: PlanSessionRow & { isKey: boolean }): string {
  const strength = isStrengthSession(session);
  const run = isRunSession(session);
  const rest = session.intensity === "rest";
  const tag = session.isKey ? (run ? "Key run" : "Key session") : strength ? "Strength" : rest ? "Rest" : run ? intensityLabel(session.intensity) : "Training";
  const tagClass = session.isKey ? "pill pill--accent" : strength || rest ? "pill pill--muted" : "pill";
  const dose = session.planned_minutes != null
    ? `${session.planned_minutes} min`
    : session.planned_km > 0
      ? `${session.planned_km.toFixed(1)} km`
      : rest
        ? "No training dose"
        : "By feel";
  return `<div class="planned-session${strength ? " planned-session--strength" : ""}">
    <span class="${tagClass}">${tag}</span>
    <h3>${esc(session.title)}</h3>
    <p>${esc(friendlySessionDescription(session))}</p>
    <span class="planned-dose">${dose}${run && !rest ? ` · ${intensityLabel(session.intensity)}` : ""}</span>
  </div>`;
}

function renderLogged(activities: LoggedActivity[], tz: string): string {
  if (activities.length === 0) return `<p class="empty">Nothing logged yet in this plan week. That is context, not a judgment—the next update will adapt from what actually happened.</p>`;
  const dayFmt = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz });
  return `<div class="logged-list">${activities
    .map((activity) => {
      const km = activity.distanceM != null && activity.distanceM > 0 ? `${(activity.distanceM / 1000).toFixed(1)} km` : "";
      const duration = activity.movingTimeS != null ? formatDuration(activity.movingTimeS) : "";
      const pace = activity.sportType.toLowerCase().includes("run") ? formatPace(activity.distanceM, activity.movingTimeS) : null;
      const stats = [km, duration, pace].filter(Boolean).join(" · ");
      return `<div class="logged-row">
        <span class="logged-day">${dayFmt.format(activity.startDate)}</span>
        <div class="logged-name"><strong>${esc(activity.name)}</strong><span>${esc(activity.sportType)}</span></div>
        <div class="logged-stats">${stats || "Completed"}</div>
      </div>`;
    })
    .join("")}</div>`;
}

function planSummary(plan: PlanRow): { runCount: number; runDose: string; intensity: string; strengthCount: number } {
  const sessions = [plan.keySession, ...plan.supportSessions];
  const runs = sessions.filter(isRunSession);
  const minutes = runs.reduce((sum, session) => sum + (session.planned_minutes ?? 0), 0);
  const km = runs.reduce((sum, session) => sum + session.planned_km, 0);
  const quality = runs.filter((session) => session.intensity === "high").length;
  return {
    runCount: runs.length,
    runDose: minutes > 0 ? `${minutes} min running` : `${km.toFixed(1)} km running`,
    intensity: quality > 0 ? `${quality} quality session${quality === 1 ? "" : "s"}` : "All easy",
    strengthCount: sessions.filter(isStrengthSession).length,
  };
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

function friendlyExplanation(plan: PlanRow): string {
  if (friendlyPhase(plan) === "Return to running") {
    return "Restore consistency with short, easy runs and generous recovery. Strength stays listed separately so you can see the complete week.";
  }
  return plan.explanation || `This week emphasizes ${friendlyPhase(plan).toLowerCase()} while preserving enough recovery to absorb the work.`;
}

function friendlySessionDescription(session: PlanSessionRow): string {
  if (!isStrengthSession(session)) return session.description;
  const cleaned = session.description
    .replace(/^recovery[- ]adjusted gym:\s*/i, "")
    .replace(/^regular gym:\s*/i, "")
    .replace(/^gym:\s*/i, "")
    .trim();
  return cleaned || "Keep the strength session controlled and leave a few reps in reserve.";
}

function isRunSession(session: PlanSessionRow): boolean {
  if (session.intensity === "rest" || isStrengthSession(session)) return false;
  return session.planned_km > 0 || /\brun(?:ning)?\b/i.test(session.title);
}

function isStrengthSession(session: PlanSessionRow): boolean {
  return /strength|weight|gym|lift/i.test(session.title);
}

function intensityLabel(intensity: PlanSessionRow["intensity"]): string {
  return intensity === "high" ? "Quality" : intensity === "rest" ? "Rest" : "Easy";
}

function addIsoDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDayDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

function formatWeekRange(weekStart: string): string {
  const end = addIsoDays(weekStart, 6);
  const startDate = new Date(`${weekStart}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const startMonth = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(startDate);
  const endMonth = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(endDate);
  const startDay = startDate.getUTCDate();
  const endDay = endDate.getUTCDate();
  return startMonth === endMonth ? `${startMonth} ${startDay}–${endDay}` : `${startMonth} ${startDay}–${endMonth} ${endDay}`;
}
