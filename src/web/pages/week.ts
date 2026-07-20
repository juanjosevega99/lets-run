import { esc } from "../html.js";
import { formatDuration, formatPace } from "../../lib/time.js";
import type { LoggedActivity, PlanRow } from "../queries.js";

/**
 * PRD F-C screen 2, "This week": the prescribed week (from plan_week, key session
 * first) and what was actually logged (from Strava).
 */
export interface WeekData {
  activities: LoggedActivity[];
  plan: PlanRow | null;
  tz: string;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function renderWeek(d: WeekData): string {
  const dayFmt = new Intl.DateTimeFormat("en", { weekday: "short", timeZone: d.tz });

  const logged =
    d.activities.length === 0
      ? `<p class="empty">Nothing logged yet this week.</p>`
      : `<table>
      <thead><tr><th>day</th><th>activity</th><th>sport</th><th class="num">km</th><th class="num">time</th><th class="num">pace</th></tr></thead>
      <tbody>${d.activities
        .map((a) => {
          const km = a.distanceM != null && a.distanceM > 0 ? (a.distanceM / 1000).toFixed(1) : "";
          const time = a.movingTimeS != null ? formatDuration(a.movingTimeS) : "";
          const pace = a.sportType.toLowerCase().includes("run")
            ? (formatPace(a.distanceM, a.movingTimeS) ?? "")
            : "";
          return `<tr><td>${dayFmt.format(a.startDate)}</td><td>${esc(a.name)}</td><td>${esc(a.sportType)}</td><td class="num">${km}</td><td class="num">${time}</td><td class="num">${pace}</td></tr>`;
        })
        .join("")}</tbody>
    </table>`;

  const planned = d.plan
    ? renderPlan(d.plan)
    : `<p class="empty">No plan yet — press <strong>Sync &amp; replan</strong> above.
       Every plan is gated by the hard-rule validator before it's shown.</p>`;

  return `
  <h1>${d.plan ? `Plan week · ${esc(d.plan.weekStart)}` : "This week"}</h1>

  <h2>Prescription</h2>
  ${planned}

  <h2>Logged in this plan week</h2>
  ${logged}`;
}

function renderPlan(plan: PlanRow): string {
  const sessions = [
    { ...plan.keySession, isKey: true },
    ...plan.supportSessions.map((s) => ({ ...s, isKey: false })),
  ].sort((a, b) => a.day - b.day);

  const rows = sessions
    .map(
      (s) =>
        `<tr${s.isKey ? ' style="font-weight:600"' : ""}>
          <td>${DAY_NAMES[s.day] ?? s.day}</td>
          <td>${s.isKey ? "★ " : ""}${esc(s.title)}</td>
          <td>${esc(s.intensity)}</td>
          <td class="num">${s.planned_minutes != null ? `${s.planned_minutes} min` : s.planned_km > 0 ? `${s.planned_km.toFixed(1)} km` : "—"}</td>
          <td>${esc(s.description)}</td>
        </tr>`,
    )
    .join("");

  return `
  ${plan.targetLimiter ? `<p class="sub">key session targets: <strong>${esc(plan.targetLimiter)}</strong></p>` : ""}
  <table>
    <thead><tr><th>day</th><th>session</th><th>intensity</th><th class="num">dose</th><th>detail</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${plan.explanation ? `<p><em>${esc(plan.explanation)}</em></p>` : ""}`;
}
