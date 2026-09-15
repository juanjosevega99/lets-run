import { esc } from "../html.js";
import type { CheckinActivity } from "../queries.js";

/**
 * The one-tap check-in prompt.
 *
 * P0 shipped the feedback loop and adoption was zero: three forms, three dropdowns
 * each, on a page the athlete rarely opens — while readiness (and therefore ALL
 * progression) waits on them. This is the friction fix, and it is careful about one
 * thing: batching is a shortcut for typing, never for reporting. The button states a
 * positive fact ("no pain on any of these runs"), so a tap is still an explicit
 * athlete report and "missing feedback is never a green signal" is untouched.
 * Anything other than the clean answer still goes through the per-run form.
 */
export function pendingRunCheckins(activities: CheckinActivity[]): CheckinActivity[] {
  return activities.filter((a) => a.feedback == null && /run/i.test(a.sportType));
}

export function renderCheckinPrompt(pending: CheckinActivity[], returnTo: "/" | "/week"): string {
  if (pending.length === 0) return "";
  const n = pending.length;
  const ids = pending.map((a) => a.id).join(",");
  const noun = n === 1 ? "run" : "runs";
  return `<div class="checkin-prompt panel">
    <div class="checkin-prompt-copy">
      <p class="eyebrow">Check-in</p>
      <p><strong>${n} ${noun}</strong> ${n === 1 ? "is" : "are"} waiting on how ${n === 1 ? "it" : "they"} felt. Until then the plan holds steady — pain-free check-ins are what unlock a bigger week.</p>
    </div>
    <form method="post" action="/actions/checkin" class="checkin-prompt-form">
      <input type="hidden" name="activity_ids" value="${esc(ids)}">
      <input type="hidden" name="pain_during" value="none">
      <input type="hidden" name="morning_soreness" value="normal">
      <input type="hidden" name="return_to" value="${esc(returnTo)}">
      <button type="submit" class="checkin-prompt-button">No pain on ${n === 1 ? "that run" : `any of those ${n} runs`}</button>
    </form>
    <p class="sub">Pain, unusual soreness, or an RPE worth recording?${returnTo === "/" ? ` <a href="/week">Use the full form</a>.` : " Use the per-run forms below."}</p>
  </div>`;
}
