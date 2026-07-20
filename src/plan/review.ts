import type { Sql } from "../db.js";
import type { PlannedSession } from "../deterministic/validator.js";
import { dateOnly } from "../lib/time.js";
import { dashboardTz } from "../web/queries.js";
import type { Log } from "../strava/sync.js";

export type WeekDecision = "PROGRESS" | "REPEAT" | "PROCEED" | "DELOAD";

export interface ActualRun {
  day: number; // 0=Monday … 6=Sunday
  distanceKm: number;
}

export interface WeekReviewInput {
  sessions: PlannedSession[];
  keySession: PlannedSession;
  actualRuns: ActualRun[];
  /** Reserved for explicit pain/illness/readiness input once the check-in UI lands. */
  redFlag?: boolean;
}

export interface WeekReviewResult {
  compliancePct: number;
  plannedKm: number;
  actualKm: number;
  keyCompleted: boolean;
  completedRunSessions: number;
  plannedRunSessions: number;
  decision: WeekDecision;
  explanation: string;
}

/** Pure planned-vs-actual controller; persistence is kept below. */
export function reviewWeek(x: WeekReviewInput): WeekReviewResult {
  const plannedRuns = x.sessions.filter((s) => s.plannedKm > 0);
  const plannedKm = plannedRuns.reduce((sum, s) => sum + s.plannedKm, 0);
  const actualKm = x.actualRuns.reduce((sum, r) => sum + Math.max(0, r.distanceKm), 0);
  // Match the key first, then other runs. A planned run moved by one day still
  // counts, while one actual run cannot satisfy multiple planned sessions.
  const unmatched = x.actualRuns.map((r) => ({ ...r, distanceKm: Math.max(0, r.distanceKm) }));
  const match = (session: PlannedSession): boolean => {
    if (session.plannedKm <= 0) return true;
    let best = -1;
    for (let i = 0; i < unmatched.length; i++) {
      const candidate = unmatched[i]!;
      if (Math.abs(candidate.day - session.day) > 1 || candidate.distanceKm < 0.75 * session.plannedKm) continue;
      if (
        best < 0 ||
        Math.abs(candidate.day - session.day) < Math.abs(unmatched[best]!.day - session.day) ||
        (Math.abs(candidate.day - session.day) === Math.abs(unmatched[best]!.day - session.day) &&
          candidate.distanceKm > unmatched[best]!.distanceKm)
      ) {
        best = i;
      }
    }
    if (best < 0) return false;
    unmatched.splice(best, 1);
    return true;
  };
  const keyCompleted = match(x.keySession);
  const completed = plannedRuns.filter((s) => s !== x.keySession && match(s));
  if (plannedRuns.includes(x.keySession) && keyCompleted) completed.push(x.keySession);
  // Extra running is load, not extra credit. It must not manufacture >100% compliance.
  const compliancePct = plannedKm > 0 ? Math.min(100, (100 * actualKm) / plannedKm) : 100;

  let decision: WeekDecision;
  let explanation: string;
  if (x.redFlag) {
    decision = "DELOAD";
    explanation = "A recovery red flag overrides training completion; reduce load and reassess.";
  } else if (!keyCompleted) {
    decision = "REPEAT";
    explanation = `The key session was not completed; repeat the same training focus before progressing.`;
  } else if (compliancePct >= 85) {
    decision = "PROGRESS";
    explanation = `Key session completed and ${compliancePct.toFixed(0)}% of planned running volume logged.`;
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
  const rows = await sql<{ day: number; distance_km: number }[]>`
    select (extract(isodow from start_date at time zone ${tz})::int - 1) as day,
           coalesce(sum(distance_m), 0) / 1000.0 as distance_km
    from activities
    where sport_type ilike '%run%'
      and (start_date at time zone ${tz}) >= ${weekStart}::date
      and (start_date at time zone ${tz}) < (${weekStart}::date + interval '7 days')
    group by 1 order by 1
  `;

  const toPlanned = (s: StoredSession): PlannedSession => ({
    day: s.day,
    title: s.title,
    intensity: s.intensity,
    plannedKm: s.planned_km,
  });
  const key = toPlanned(plan.key_session);
  const sessions = [key, ...plan.support_sessions.map(toPlanned)];
  const result = reviewWeek({
    sessions,
    keySession: key,
    actualRuns: rows.map((r) => ({ day: r.day, distanceKm: Number(r.distance_km) })),
  });

  await sql`
    insert into week_review (
      week_start, compliance_pct, planned_load, actual_load, decision, decision_inputs, explanation
    ) values (
      ${weekStart}, ${result.compliancePct}, ${result.plannedKm}, ${result.actualKm}, ${result.decision},
      ${sql.json({
        unit: "running_km",
        key_completed: result.keyCompleted,
        completed_run_sessions: result.completedRunSessions,
        planned_run_sessions: result.plannedRunSessions,
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
  log(`week review ${weekStart}: ${result.decision} · ${result.compliancePct.toFixed(0)}% · key ${result.keyCompleted ? "done" : "missed"}`);
  return result;
}

export async function latestWeekDecision(sql: Sql): Promise<WeekDecision | null> {
  const rows = await sql<{ decision: WeekDecision | null }[]>`
    select decision from week_review order by week_start desc limit 1
  `;
  return rows[0]?.decision ?? null;
}
