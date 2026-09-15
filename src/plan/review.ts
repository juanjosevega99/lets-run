import type { Sql } from "../db.js";
import type { PlannedSession } from "../deterministic/validator.js";
import { dateOnly } from "../lib/time.js";
import { dashboardTz } from "../web/queries.js";
import type { Log } from "../strava/sync.js";
import {
  deriveReadiness,
  type GymDifficulty,
  type GymFocus,
  type PainLevel,
  type SessionFeedback,
  type SorenessLevel,
} from "./feedback.js";

export type WeekDecision = "PROGRESS" | "REPEAT" | "PROCEED" | "DELOAD";

export interface ActualRun {
  day: number; // 0=Monday … 6=Sunday
  distanceKm: number;
  durationMinutes?: number;
}

export interface WeekReviewInput {
  sessions: PlannedSession[];
  keySession: PlannedSession;
  actualRuns: ActualRun[];
  /** Reserved for explicit pain/illness/readiness input once the check-in UI lands. */
  redFlag?: boolean;
  /** Must be explicit; missing subjective data cannot earn progression. */
  readinessConfirmed?: boolean;
  /**
   * Credit run sessions from any day of the week instead of within +/-1 day. True for
   * an all-easy week, where the sessions are interchangeable easy runs and the key is
   * simply the longest of them — no calendar slot carries physiological meaning. Weeks
   * with a real intensity structure keep the strict window: there, placement IS the
   * prescription (a threshold session three days from its recovery run is a different
   * week). Named for the key because that is where it matters most.
   */
  keyMatchesAnyDay?: boolean;
}

export interface WeekReviewResult {
  compliancePct: number;
  plannedKm: number;
  actualKm: number;
  plannedMinutes: number;
  actualMinutes: number;
  keyCompleted: boolean;
  completedRunSessions: number;
  plannedRunSessions: number;
  decision: WeekDecision;
  explanation: string;
}

/** Pure planned-vs-actual controller; persistence is kept below. */
export function reviewWeek(x: WeekReviewInput): WeekReviewResult {
  const plannedRuns = x.sessions.filter((s) => s.plannedKm > 0 || (s.plannedMinutes ?? 0) > 0);
  const plannedKm = plannedRuns.reduce((sum, s) => sum + s.plannedKm, 0);
  const actualKm = x.actualRuns.reduce((sum, r) => sum + Math.max(0, r.distanceKm), 0);
  const plannedMinutes = plannedRuns.reduce((sum, s) => sum + Math.max(0, s.plannedMinutes ?? 0), 0);
  const actualMinutes = x.actualRuns.reduce((sum, r) => sum + Math.max(0, r.durationMinutes ?? 0), 0);
  // Match the key first, then other runs. A planned run moved by one day still
  // counts, while one actual run cannot satisfy multiple planned sessions.
  const unmatched = x.actualRuns.map((r) => ({ ...r, distanceKm: Math.max(0, r.distanceKm) }));
  const byDuration = (session: PlannedSession): boolean =>
    session.plannedMinutes != null && session.plannedMinutes > 0;
  const dose = (session: PlannedSession, run: ActualRun): number =>
    byDuration(session) ? (run.durationMinutes ?? 0) : run.distanceKm;
  const match = (session: PlannedSession, anyDay = false): boolean => {
    if (session.plannedKm <= 0 && (session.plannedMinutes ?? 0) <= 0) return true;
    const required = byDuration(session) ? 0.75 * session.plannedMinutes! : 0.75 * session.plannedKm;
    let best = -1;
    for (let i = 0; i < unmatched.length; i++) {
      const candidate = unmatched[i]!;
      if (dose(session, candidate) < required) continue;
      if (!anyDay && Math.abs(candidate.day - session.day) > 1) continue;
      if (best < 0) {
        best = i;
        continue;
      }
      const incumbent = unmatched[best]!;
      // Day-anchored sessions still prefer the nearest day; a session that may land on
      // any day is credited to the BIGGEST qualifying run, so the key is never spent on
      // a short midweek jog while the week's real long run counts as filler.
      const nearer = Math.abs(candidate.day - session.day) - Math.abs(incumbent.day - session.day);
      if (anyDay || nearer === 0) {
        if (dose(session, candidate) > dose(session, incumbent)) best = i;
      } else if (nearer < 0) {
        best = i;
      }
    }
    if (best < 0) return false;
    unmatched.splice(best, 1);
    return true;
  };
  const anyDay = x.keyMatchesAnyDay === true;
  const keyCompleted = match(x.keySession, anyDay);
  // Support runs in an all-easy week are interchangeable too. Matching them by date
  // undercounted real work: three runs against a three-run week scored 2/3 purely
  // because one landed on Monday instead of Thursday.
  const completed = plannedRuns.filter((s) => s !== x.keySession && match(s, anyDay));
  if (plannedRuns.includes(x.keySession) && keyCompleted) completed.push(x.keySession);
  // Extra running is load, not extra credit. It must not manufacture >100% compliance.
  const compliancePct =
    plannedMinutes > 0
      ? Math.min(100, (100 * actualMinutes) / plannedMinutes)
      : plannedKm > 0
        ? Math.min(100, (100 * actualKm) / plannedKm)
        : 100;

  let decision: WeekDecision;
  let explanation: string;
  if (x.redFlag) {
    decision = "DELOAD";
    explanation = "A recovery red flag overrides training completion; reduce load and reassess.";
  } else if (!keyCompleted) {
    decision = "REPEAT";
    explanation = `The key session was not completed; repeat the same training focus before progressing.`;
  } else if (compliancePct >= 85 && x.readinessConfirmed) {
    decision = "PROGRESS";
    explanation = `Key session completed and ${compliancePct.toFixed(0)}% of the planned running dose logged; readiness confirmed.`;
  } else if (compliancePct >= 85) {
    decision = "PROCEED";
    explanation = `Training dose was completed, but pain/soreness readiness was not confirmed; hold before progressing.`;
  } else if (compliancePct >= 60) {
    decision = "PROCEED";
    explanation = `Key session completed; lower-priority volume was missed (${compliancePct.toFixed(0)}% compliance).`;
  } else {
    decision = "REPEAT";
    explanation = `Only ${compliancePct.toFixed(0)}% of planned volume was logged; hold the focus and rebuild consistency.`;
  }

  return {
    compliancePct,
    plannedKm,
    actualKm,
    plannedMinutes,
    actualMinutes,
    keyCompleted,
    completedRunSessions: completed.length,
    plannedRunSessions: plannedRuns.length,
    decision,
    explanation,
  };
}

interface StoredSession {
  day: number;
  title: string;
  intensity: "low" | "high" | "rest";
  planned_km: number;
  planned_minutes?: number;
}

/**
 * Reviews the newest completed, unreviewed plan week. Safe to call before every
 * replan; it is a no-op until a full planned week has elapsed and upserts by week.
 */
export async function reviewLatestCompletedWeek(
  sql: Sql,
  currentWeekStart: string,
  log: Log = () => {},
): Promise<WeekReviewResult | null> {
  const plans = await sql<
    {
      week_start: unknown;
      key_session: StoredSession;
      support_sessions: StoredSession[];
    }[]
  >`
    select p.week_start, p.key_session, p.support_sessions
    from plan_week p
    left join week_review wr on wr.week_start = p.week_start
    where p.week_start < ${currentWeekStart}::date and wr.id is null
    order by p.week_start desc limit 1
  `;
  const plan = plans[0];
  if (!plan) return null;

  const weekStart = dateOnly(plan.week_start);
  const tz = dashboardTz();
  // Per-ACTIVITY rows, not per-day sums: the ids are what check-ins are filed under,
  // and readiness is derived from them. Runs are re-aggregated per day below so the
  // planned-vs-actual matching behaves exactly as it did before.
  const activities = await sql<
    { id: string | number; day: number; distance_km: number; duration_minutes: number; sport_type: string }[]
  >`
    select a.id,
           (extract(isodow from a.start_date at time zone ${tz})::int - 1) as day,
           coalesce(a.distance_m, 0) / 1000.0 as distance_km,
           coalesce(case when a.moving_time_s > 0 then a.moving_time_s else a.elapsed_time_s end, 0) / 60.0
             as duration_minutes,
           a.sport_type
    from activities a
    where (a.start_date at time zone ${tz}) >= ${weekStart}::date
      and (a.start_date at time zone ${tz}) < (${weekStart}::date + interval '7 days')
    order by a.start_date
  `;

  const runActivities = activities.filter((a) => /run/i.test(a.sport_type));
  const byDay = new Map<number, { day: number; distanceKm: number; durationMinutes: number }>();
  for (const run of runActivities) {
    const bucket = byDay.get(run.day) ?? { day: run.day, distanceKm: 0, durationMinutes: 0 };
    bucket.distanceKm += Number(run.distance_km);
    bucket.durationMinutes += Number(run.duration_minutes);
    byDay.set(run.day, bucket);
  }
  const rows = [...byDay.values()].sort((a, b) => a.day - b.day);

  // A painful GYM session is still a stop signal, so readiness reads the whole week's
  // check-ins — but only RUNS can confirm that impact was tolerated.
  const weekFeedback =
    activities.length > 0 ? await feedbackForActivities(sql, activities.map((a) => Number(a.id))) : [];
  const readiness = deriveReadiness(
    runActivities.map((a) => Number(a.id)),
    weekFeedback,
  );

  const toPlanned = (s: StoredSession): PlannedSession => ({
    day: s.day,
    title: s.title,
    intensity: s.intensity,
    plannedKm: s.planned_km,
    plannedMinutes: s.planned_minutes,
  });
  const key = toPlanned(plan.key_session);
  const sessions = [key, ...plan.support_sessions.map(toPlanned)];
  // An all-easy week prescribes a dose, not a date. Scoring its key session within
  // +/-1 day marked genuine long runs as missed — 61 logged minutes against 45 planned,
  // including a run 2.7x the planned key, still scored REPEAT because it fell on Monday
  // instead of Sunday. That REPEAT then held the next week's progression flat.
  const keyMatchesAnyDay = sessions.every((s) => s.intensity !== "high");
  const result = reviewWeek({
    sessions,
    keySession: key,
    keyMatchesAnyDay,
    actualRuns: rows,
    redFlag: readiness.redFlag,
    readinessConfirmed: readiness.readinessConfirmed,
  });

  await sql`
    insert into week_review (
      week_start, compliance_pct, planned_load, actual_load, decision, decision_inputs, explanation
    ) values (
      ${weekStart}, ${result.compliancePct},
      ${result.plannedMinutes > 0 ? result.plannedMinutes : result.plannedKm},
      ${result.plannedMinutes > 0 ? result.actualMinutes : result.actualKm}, ${result.decision},
      ${sql.json({
        unit: result.plannedMinutes > 0 ? "running_minutes" : "running_km",
        key_completed: result.keyCompleted,
        completed_run_sessions: result.completedRunSessions,
        planned_run_sessions: result.plannedRunSessions,
        readiness_confirmed: readiness.readinessConfirmed,
        red_flag: readiness.redFlag,
        readiness_reasons: readiness.reasons,
        runs_checked_in: readiness.runsCheckedIn,
        runs_total: readiness.runsTotal,
      })},
      ${result.explanation}
    )
    on conflict (week_start) do update set
      compliance_pct = excluded.compliance_pct,
      planned_load = excluded.planned_load,
      actual_load = excluded.actual_load,
      decision = excluded.decision,
      decision_inputs = excluded.decision_inputs,
      explanation = excluded.explanation,
      reviewed_at = now()
  `;
  log(
    `week review ${weekStart}: ${result.decision} · ${result.compliancePct.toFixed(0)}% · key ${result.keyCompleted ? "done" : "missed"} · check-ins ${readiness.runsCheckedIn}/${readiness.runsTotal}${readiness.reasons.length > 0 ? ` · ${readiness.reasons[0]}` : ""}`,
  );
  return result;
}

/** The week's check-ins, keyed by activity id. Empty list in, empty list out. */
async function feedbackForActivities(sql: Sql, activityIds: number[]): Promise<SessionFeedback[]> {
  if (activityIds.length === 0) return [];
  const rows = await sql<
    {
      activity_id: string | number;
      rpe: number | null;
      pain_during: PainLevel;
      morning_soreness: SorenessLevel;
      gym_focus: GymFocus | null;
      lower_body_difficulty: GymDifficulty | null;
      notes: string | null;
    }[]
  >`
    select activity_id, rpe, pain_during, morning_soreness, gym_focus, lower_body_difficulty, notes
    from session_feedback where activity_id = any(${activityIds})
  `;
  return rows.map((r) => ({
    activityId: Number(r.activity_id),
    rpe: r.rpe,
    painDuring: r.pain_during,
    morningSoreness: r.morning_soreness,
    gymFocus: r.gym_focus,
    lowerBodyDifficulty: r.lower_body_difficulty,
    notes: r.notes,
  }));
}

export async function latestWeekDecision(sql: Sql): Promise<WeekDecision | null> {
  const rows = await sql<{ decision: WeekDecision | null }[]>`
    select decision from week_review order by week_start desc limit 1
  `;
  return rows[0]?.decision ?? null;
}
