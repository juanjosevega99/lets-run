import { esc } from "../html.js";
import { formatDuration, formatPace } from "../../lib/time.js";
import type { LoggedActivity } from "../queries.js";

/**
 * PRD F-C screen 2, "This week": what was actually logged this week (real, from Strava)
 * and the prescribed week (empty until F-A/F3 exist — the plan generator needs the
 * deterministic layer to decide the limiter before the LLM can phrase the week).
 */
export interface WeekData {
  activities: LoggedActivity[];
  tz: string;
}

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

  return `
  <h1>This week</h1>

  <h2>Planned</h2>
  <p class="empty">No plan yet — this is PRD F-A/F-B territory. When it exists, this section
  leads with the <strong>key session</strong> (the limiter it targets and its modeled
  time-gain on the race prediction), support sessions below, and one paragraph of <em>why</em>.
  It requires the hand-written deterministic layer (F1) first: the plan's "what" is math,
  only its phrasing is the LLM's.</p>

  <h2>Logged</h2>
  ${logged}`;
}
