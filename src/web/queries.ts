import type { Sql } from "../db.js";
import { dateOnly } from "../lib/time.js";

/**
 * Display-level SQL aggregations for the dashboard. Deliberately dumb: sums, counts,
 * group-bys. Anything resembling a fitness/load MODEL (TRIMP, CTL, GAP...) belongs in
 * src/deterministic/ — the hand-written zone — and is not computed here.
 *
 * Weeks are ISO weeks (Monday start) in the athlete's local timezone
 * (DASHBOARD_TZ, default America/Bogota) so a Saturday-night run doesn't slide
 * into the wrong week via UTC.
 */

const RUN_TYPES = ["Run", "Trail Run", "TrailRun"]; // export shows "Run"; API may add trail variants

export function dashboardTz(): string {
  return process.env.DASHBOARD_TZ ?? "America/Bogota";
}

export interface WeekVolume {
  weekStart: string; // YYYY-MM-DD (Monday)
  km: number;
  runs: number;
}

export async function weeklyRunVolume(sql: Sql, weeks: number): Promise<WeekVolume[]> {
  const tz = dashboardTz();
  // generate_series zero-fills weeks with no running — a gap must LOOK like a gap,
  // otherwise the trajectory chart overstates continuity.
  const rows = await sql<{ week_start: string; meters: number; runs: number }[]>`
    with weeks as (
      select generate_series(
        date_trunc('week', now() at time zone ${tz}) - make_interval(weeks => ${weeks - 1}),
        date_trunc('week', now() at time zone ${tz}),
        interval '1 week') as wk
    ), vol as (
      select date_trunc('week', start_date at time zone ${tz}) as wk,
             sum(distance_m) as meters,
             count(*)::int as runs
      from activities
      where sport_type = any(${RUN_TYPES})
      group by 1
    )
    select weeks.wk::date::text as week_start,
           coalesce(vol.meters, 0) as meters,
           coalesce(vol.runs, 0)::int as runs
    from weeks left join vol using (wk)
    order by 1
  `;
  return rows.map((r) => ({ weekStart: r.week_start, km: r.meters / 1000, runs: r.runs }));
}

/** Average weekly running km across 2021–2022 (weeks that had at least one run). */
export async function peakEraWeeklyAvgKm(sql: Sql): Promise<number | null> {
  const tz = dashboardTz();
  const rows = await sql<{ avg_m: number | null }[]>`
    with w as (
      select date_trunc('week', start_date at time zone ${tz}) as wk,
             sum(distance_m) as m
      from activities
      where sport_type = any(${RUN_TYPES})
        and start_date >= '2021-01-01' and start_date < '2023-01-01'
      group by 1
    )
    select avg(m) as avg_m from w
  `;
  const avg = rows[0]?.avg_m;
  return avg == null ? null : avg / 1000;
}

export interface RecentSnapshot {
  days: number;
  runs: number;
  runKm: number;
  runTimeS: number;
  longestRunKm: number | null;
  bySport: { sport: string; count: number; km: number }[];
}

export async function recentSnapshot(sql: Sql, days: number): Promise<RecentSnapshot> {
  const runs = await sql<{ n: number; meters: number; secs: number; longest: number | null }[]>`
    select count(*)::int as n,
           coalesce(sum(distance_m), 0) as meters,
           coalesce(sum(moving_time_s), 0) as secs,
           max(distance_m) as longest
    from activities
    where sport_type = any(${RUN_TYPES})
      and start_date >= now() - make_interval(days => ${days})
  `;
  const sports = await sql<{ sport_type: string; n: number; meters: number }[]>`
    select sport_type, count(*)::int as n, coalesce(sum(distance_m), 0) as meters
    from activities
    where start_date >= now() - make_interval(days => ${days})
    group by 1 order by 2 desc
  `;
  const r = runs[0]!;
  return {
    days,
    runs: r.n,
    runKm: r.meters / 1000,
    runTimeS: r.secs,
    longestRunKm: r.longest == null ? null : r.longest / 1000,
    bySport: sports.map((s) => ({ sport: s.sport_type, count: s.n, km: s.meters / 1000 })),
  };
}

export interface LoggedActivity {
  startDate: Date;
  name: string;
  sportType: string;
  distanceM: number | null;
  movingTimeS: number | null;
}

/** Activities in the current local ISO week, oldest first. */
export async function thisWeekActivities(sql: Sql): Promise<LoggedActivity[]> {
  const tz = dashboardTz();
  const rows = await sql<
    { start_date: Date; name: string; sport_type: string; distance_m: number | null; moving_time_s: number | null }[]
  >`
    select start_date, name, sport_type, distance_m, moving_time_s
    from activities
    where date_trunc('week', start_date at time zone ${tz})
          = date_trunc('week', now() at time zone ${tz})
    order by start_date
  `;
  return rows.map((r) => ({
    startDate: r.start_date,
    name: r.name,
    sportType: r.sport_type,
    distanceM: r.distance_m,
    movingTimeS: r.moving_time_s,
  }));
}

export async function latestActivityDate(sql: Sql): Promise<Date | null> {
  const rows = await sql<{ latest: Date | null }[]>`select max(start_date) as latest from activities`;
  return rows[0]?.latest ?? null;
}

export interface RaceRow {
  name: string;
  raceDate: string;
  distanceKm: number;
  officialTimeS: number;
  terrain: string;
}

export async function allRaces(sql: Sql): Promise<RaceRow[]> {
  const rows = await sql<
    { name: string; race_date: unknown; distance_m: number; official_time_s: number; terrain: string }[]
  >`select name, race_date, distance_m, official_time_s, terrain from races order by race_date`;
  return rows.map((r) => ({
    name: r.name,
    raceDate: dateOnly(r.race_date),
    distanceKm: r.distance_m / 1000,
    officialTimeS: r.official_time_s,
    terrain: r.terrain,
  }));
}

export interface FitnessRow {
  day: string;
  ctl: number;
  atl: number;
  tsb: number;
}

/** Today's (latest) Banister state, if the fitness pipeline has run. */
export async function latestFitness(sql: Sql): Promise<FitnessRow | null> {
  const rows = await sql<{ day: unknown; ctl: number; atl: number; tsb: number }[]>`
    select day, ctl, atl, tsb from fitness_state order by day desc limit 1
  `;
  const r = rows[0];
  return r ? { day: dateOnly(r.day), ctl: r.ctl, atl: r.atl, tsb: r.tsb } : null;
}

export interface PlanSessionRow {
  day: number;
  title: string;
  description: string;
  intensity: "low" | "high" | "rest";
  planned_km: number;
}

export interface PlanRow {
  weekStart: string;
  targetLimiter: string | null;
  keySession: PlanSessionRow;
  supportSessions: PlanSessionRow[];
  explanation: string | null;
  generatedAt: Date;
}

/** The most recently generated plan (current or upcoming week). */
export async function latestPlan(sql: Sql): Promise<PlanRow | null> {
  const rows = await sql<
    {
      week_start: unknown;
      target_limiter: string | null;
      key_session: PlanSessionRow;
      support_sessions: PlanSessionRow[];
      explanation: string | null;
      generated_at: Date;
    }[]
  >`
    select week_start, target_limiter, key_session, support_sessions, explanation, generated_at
    from plan_week order by week_start desc limit 1
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    weekStart: dateOnly(r.week_start),
    targetLimiter: r.target_limiter,
    keySession: r.key_session,
    supportSessions: r.support_sessions,
    explanation: r.explanation,
    generatedAt: r.generated_at,
  };
}

export interface PredictionRow {
  predictedAt: Date;
  predictedTimeS: number;
  intervalP10S: number | null;
  intervalP90S: number | null;
  predictor: string;
}

/** Live (non-backtest) predictions, oldest first. Empty until F1+F2 exist. */
export async function livePredictions(sql: Sql): Promise<PredictionRow[]> {
  const rows = await sql<
    {
      predicted_at: Date;
      predicted_time_s: number;
      interval_p10_s: number | null;
      interval_p90_s: number | null;
      predictor: string;
    }[]
  >`
    select predicted_at, predicted_time_s, interval_p10_s, interval_p90_s, predictor
    from prediction_log
    where race_id is null
    order by predicted_at
  `;
  return rows.map((r) => ({
    predictedAt: r.predicted_at,
    predictedTimeS: r.predicted_time_s,
    intervalP10S: r.interval_p10_s,
    intervalP90S: r.interval_p90_s,
    predictor: r.predictor,
  }));
}
