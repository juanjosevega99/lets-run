import type { Sql } from "../db.js";
import type { PlanContext } from "./generate.js";
import { trainingPaces, vdotFromRace } from "../deterministic/vdot.js";
import { hrZones, median, resolveHrMax } from "../deterministic/zones.js";
import { selectTrainingFocus, selectTrainingPhase } from "../deterministic/trainingPhase.js";
import { RACE, daysToRace } from "../lib/race.js";
import { dateOnly } from "../lib/time.js";
import { weeklyRunVolume, latestFitness, livePredictions, dashboardTz } from "../web/queries.js";
import { latestWeekDecision } from "./review.js";

/** YYYY-MM-DD of the next Monday in the athlete's local timezone. Used as plan_week's key. */
export function nextMonday(now: Date = new Date()): string {
  const tz = dashboardTz();
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now.getTime() + i * 86_400_000);
    const weekday = new Intl.DateTimeFormat("en", { weekday: "short", timeZone: tz }).format(d);
    if (weekday === "Mon") {
      return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d); // YYYY-MM-DD
    }
  }
  throw new Error("unreachable: no Monday in the next 7 days");
}

/** Monday of the athlete's current local week. */
export function currentMonday(now: Date = new Date()): string {
  const tz = dashboardTz();
  for (let i = 0; i <= 6; i++) {
    const d = new Date(now.getTime() - i * 86_400_000);
    const weekday = new Intl.DateTimeFormat("en", { weekday: "short", timeZone: tz }).format(d);
    if (weekday === "Mon") return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
  }
  throw new Error("unreachable: no Monday in the previous 7 days");
}

/** Sunday-evening replans may review the week that just finished; midweek replans may not. */
export function reviewCutoffForReplan(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
    timeZone: dashboardTz(),
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  // Do not mark Sunday's key run missed because somebody refreshed at breakfast.
  return weekday === "Sun" && hour >= 18 ? nextMonday(now) : currentMonday(now);
}

/**
 * On Sunday evening the current calendar week is essentially finished, so it should be
 * the progression baseline for next week — matching the review, which evaluates that
 * same just-finished week. Midweek it is still in progress and must not be the baseline.
 * (Red-team H2: without this, a Sunday replan baselined next week on TWO weeks ago.)
 */
export function currentWeekIsComplete(now: Date = new Date()): boolean {
  return reviewCutoffForReplan(now) === nextMonday(now);
}

/**
 * Assembles the deterministic inputs both plan paths need: the full LLM week
 * generator (generate.ts) and the no-API single-day suggestion (tomorrow.ts).
 * Everything here is math over fitness_state/activities/races — zero LLM calls.
 */
export async function buildPlanContext(sql: Sql): Promise<PlanContext> {
  const fitness = await latestFitness(sql);
  if (!fitness) throw new Error("fitness_state is empty — run `npm run fitness:rebuild` first");

  const weeks = await weeklyRunVolume(sql, 5); // ends with the current (local) week
  // On Sunday evening the current week counts as finished; otherwise drop it as in-progress.
  const completedWeeks = currentWeekIsComplete() ? weeks : weeks.slice(0, -1);
  const previousWeekKm = completedWeeks.at(-1)?.km ?? null;

  const recent = await sql<
    {
      runs_28d: number;
      longest_30d_m: number | null;
      longest_120d_m: number | null;
      days_since_last_run: number | null;
    }[]
  >`
    select
      count(*) filter (where start_date >= now() - interval '28 days')::int as runs_28d,
      max(distance_m) filter (where start_date >= now() - interval '30 days') as longest_30d_m,
      max(distance_m) filter (where start_date >= now() - interval '120 days') as longest_120d_m,
      ((now() at time zone ${dashboardTz()})::date -
        max((start_date at time zone ${dashboardTz()})::date))::int as days_since_last_run
    from activities
    where sport_type ilike '%run%'
  `;

  const races = await sql<{ distance_m: number; official_time_s: number; race_date: unknown }[]>`
    select distance_m, official_time_s, race_date from races`;
  const bestVdot =
    races.length > 0 ? Math.max(...races.map((r) => vdotFromRace(r.distance_m, r.official_time_s))) : null;
  const vdotPaces = bestVdot ? trainingPaces(bestVdot) : null;
  const freshAnchorCutoff = Date.now() - 180 * 86_400_000;
  const hasFreshPerformanceAnchor = races.some(
    (r) => Date.parse(`${dateOnly(r.race_date)}T00:00:00Z`) >= freshAnchorCutoff,
  );

  // HR ceiling for easy running, from observed max HR.
  const hrRow = await sql<{ hr_max: number | null }[]>`
    select max(max_hr) as hr_max from activities where max_hr is not null`;
  const observedHrMax = hrRow[0]?.hr_max ?? null;
  // Keep prescription consistent with the load model: reject implausible sensor
  // spikes rather than turning one bad sample into an unsafe easy-HR ceiling.
  const hrMax = observedHrMax == null ? null : resolveHrMax(observedHrMax);
  const zones = hrMax ? hrZones({ hrMax, hrRest: Number(process.env.ATHLETE_HR_REST ?? 55) }) : null;

  // Observed easy pace: what pace does he ACTUALLY run at easy heart rate, recently?
  // This reflects CURRENT fitness. A peak-VDOT-derived pace does not — prescribing it
  // to a detrained athlete turns every "easy" run into a threshold effort.
  let observedEasySecPerKm: number | null = null;
  if (zones) {
    const easyRuns = await sql<{ distance_m: number; moving_time_s: number }[]>`
      select distance_m, moving_time_s from activities
      where sport_type ilike '%run%'
        and avg_hr is not null and avg_hr <= ${zones.easyCeiling}
        and distance_m > 2000 and moving_time_s > 0
        and start_date >= now() - interval '180 days'
    `;
    observedEasySecPerKm = median(easyRuns.map((r) => r.moving_time_s / (r.distance_m / 1000)));
  }

  const paceSource: "observed" | "vdot" | null = observedEasySecPerKm
    ? "observed"
    : vdotPaces
      ? "vdot"
      : null;
  const paces = vdotPaces
    ? {
        easySecPerKm: observedEasySecPerKm ?? vdotPaces.easySecPerKm,
        thresholdSecPerKm: hasFreshPerformanceAnchor ? vdotPaces.thresholdSecPerKm : null,
      }
    : observedEasySecPerKm
      ? { easySecPerKm: observedEasySecPerKm, thresholdSecPerKm: null }
      : null;

  const recentRow = recent[0]!;
  const runs28d = recentRow.runs_28d;
  const activeRunWeeks4 = completedWeeks.filter((w) => w.runs > 0).length;
  const qualityShare28d = zones ? await recentThresholdTimeShare(sql, zones.threshold) : null;
  const raceDays = daysToRace(new Date());
  const trainingPhase = selectTrainingPhase({
    daysToRace: raceDays,
    daysSinceLastRun: recentRow.days_since_last_run,
    runs28d,
    activeRunWeeks4,
  });
  const limiter = selectTrainingFocus({
    phase: trainingPhase,
    daysToRace: raceDays,
    daysSinceLastRun: recentRow.days_since_last_run,
    runs28d,
    activeRunWeeks4,
    longestRunKm30d: (recentRow.longest_30d_m ?? 0) / 1000,
    raceKm: RACE.distanceM / 1000,
    qualityShare28d,
  });

  const predictions = await livePredictions(sql);
  const strengthDays = await loadStrengthDays(sql);
  const lowerBodyStrengthDays = parseDayList(process.env.ATHLETE_LOWER_BODY_DAYS);
  const previousDecision = await latestWeekDecision(sql);

  return {
    limiter,
    trainingPhase,
    ctl: fitness.ctl,
    atl: fitness.atl,
    tsb: fitness.tsb,
    aerobicCtl: fitness.aerobicCtl,
    aerobicTsb:
      fitness.aerobicCtl != null && fitness.aerobicAtl != null
        ? fitness.aerobicCtl - fitness.aerobicAtl
        : null,
    totalAtl: fitness.totalAtl,
    totalTsb: fitness.totalTsb,
    previousWeekKm,
    recentWeeklyKm: completedWeeks.map((w) => w.km),
    runs28d,
    activeRunWeeks4,
    daysSinceLastRun: recentRow.days_since_last_run,
    longestRunKm30d: (recentRow.longest_30d_m ?? 0) / 1000,
    longestRunKm120d: (recentRow.longest_120d_m ?? 0) / 1000,
    qualityShare28d,
    strengthDays,
    lowerBodyStrengthDays,
    previousDecision,
    paces,
    paceSource,
    easyHrCeiling: zones?.easyCeiling ?? null,
    daysToRace: raceDays,
    targetTimeS: RACE.targetTimeS,
    raceName: RACE.name,
    predictedTimeS: predictions.at(-1)?.predictedTimeS ?? null,
  };
}

async function recentThresholdTimeShare(sql: Sql, thresholdHr: number): Promise<number | null> {
  const runs = await sql<
    {
      moving_time_s: number | null;
      avg_hr: number | null;
      time_s: number[] | null;
      heartrate: (number | null)[] | null;
    }[]
  >`
    select a.moving_time_s, a.avg_hr, s.time_s, s.heartrate
    from activities a left join activity_streams s on s.activity_id = a.id
    where a.sport_type ilike '%run%'
      and a.start_date >= now() - interval '28 days'
  `;
  let measuredS = 0;
  let thresholdS = 0;
  for (const run of runs) {
    const times = run.time_s;
    const hrs = run.heartrate;
    if (times && hrs && times.length > 1 && hrs.length === times.length) {
      for (let i = 0; i < times.length - 1; i++) {
        const dt = Math.max(0, Math.min(30, times[i + 1]! - times[i]!));
        if (hrs[i] != null) {
          measuredS += dt;
          if (hrs[i]! >= thresholdHr) thresholdS += dt;
        }
      }
    } else if (run.moving_time_s && run.moving_time_s > 0 && run.avg_hr != null) {
      measuredS += run.moving_time_s;
      if (run.avg_hr >= thresholdHr) thresholdS += run.moving_time_s;
    }
  }
  return measuredS > 0 ? thresholdS / measuredS : null;
}

async function loadStrengthDays(sql: Sql): Promise<number[]> {
  const configured = parseDayList(process.env.ATHLETE_GYM_DAYS);
  if (configured.length > 0) return configured;
  const rows = await sql<{ day: number; sessions: number }[]>`
    select (extract(isodow from start_date at time zone ${dashboardTz()})::int - 1) as day,
           count(*)::int as sessions
    from activities
    where (sport_type ilike '%weight%' or sport_type ilike '%strength%')
      and start_date >= now() - interval '120 days'
    group by 1 order by 1
  `;
  const max = Math.max(0, ...rows.map((r) => r.sessions));
  return rows.filter((r) => r.sessions >= Math.max(2, max * 0.5)).map((r) => r.day);
}

function parseDayList(value: string | undefined): number[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(",").map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort(
    (a, b) => a - b,
  );
}
