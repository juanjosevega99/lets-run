import type { Sql } from "../db.js";
import type { PlanContext } from "./generate.js";
import { findLimiter } from "../deterministic/limiter.js";
import { trainingPaces, vdotFromRace } from "../deterministic/vdot.js";
import { hrZones, median } from "../deterministic/zones.js";
import { RACE, daysToRace } from "../lib/race.js";
import { weeklyRunVolume, latestFitness, livePredictions, dashboardTz } from "../web/queries.js";

/** YYYY-MM-DD of the next Monday in the athlete's local timezone. Used as plan_week's key. */
export function nextMonday(): string {
  const tz = dashboardTz();
  const now = new Date();
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now.getTime() + i * 86_400_000);
    const weekday = new Intl.DateTimeFormat("en", { weekday: "short", timeZone: tz }).format(d);
    if (weekday === "Mon") {
      return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d); // YYYY-MM-DD
    }
  }
  throw new Error("unreachable: no Monday in the next 7 days");
}

/**
 * Assembles the deterministic inputs both plan paths need: the full LLM week
 * generator (generate.ts) and the no-API single-day suggestion (tomorrow.ts).
 * Everything here is math over fitness_state/activities/races — zero LLM calls.
 */
export async function buildPlanContext(sql: Sql): Promise<PlanContext> {
  const fitness = await latestFitness(sql);
  if (!fitness) throw new Error("fitness_state is empty — run `npm run fitness:rebuild` first");

  const peak = await sql<{ peak: number | null }[]>`select max(ctl) as peak from fitness_state`;
  const weeks = await weeklyRunVolume(sql, 5); // current week + 4 full weeks
  const completedWeeks = weeks.slice(0, -1);
  const previousWeekKm = completedWeeks.at(-1)?.km ?? null;

  const longest = await sql<{ longest_m: number | null }[]>`
    select max(distance_m) as longest_m from activities
    where sport_type = any(${["Run", "Trail Run", "TrailRun"]})
      and start_date >= now() - interval '28 days'
  `;

  const races = await sql<{ distance_m: number; official_time_s: number }[]>`
    select distance_m, official_time_s from races`;
  const bestVdot =
    races.length > 0 ? Math.max(...races.map((r) => vdotFromRace(r.distance_m, r.official_time_s))) : null;
  const vdotPaces = bestVdot ? trainingPaces(bestVdot) : null;

  // HR ceiling for easy running, from observed max HR.
  const hrRow = await sql<{ hr_max: number | null }[]>`
    select max(max_hr) as hr_max from activities where max_hr is not null`;
  const hrMax = hrRow[0]?.hr_max ?? null;
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
        thresholdSecPerKm: vdotPaces.thresholdSecPerKm,
      }
    : observedEasySecPerKm
      ? { easySecPerKm: observedEasySecPerKm, thresholdSecPerKm: observedEasySecPerKm * 0.82 }
      : null;

  const limiter = findLimiter({
    ctl: fitness.ctl,
    peakCtl: peak[0]?.peak ?? 0,
    longestRunKm28d: (longest[0]?.longest_m ?? 0) / 1000,
    raceKm: RACE.distanceM / 1000,
    // v1: quality share not yet derived per-session; treat as adequate so the
    // heuristic falls through to base/long-endurance rules, which dominate anyway
    // while detrained. Refine when session classification exists.
    qualityShare28d: 1,
  });

  const predictions = await livePredictions(sql);

  return {
    limiter,
    ctl: fitness.ctl,
    atl: fitness.atl,
    tsb: fitness.tsb,
    previousWeekKm: previousWeekKm != null && previousWeekKm > 0 ? previousWeekKm : null,
    recentWeeklyKm: completedWeeks.map((w) => w.km),
    paces,
    paceSource,
    easyHrCeiling: zones?.easyCeiling ?? null,
    daysToRace: daysToRace(new Date()),
    targetTimeS: RACE.targetTimeS,
    raceName: RACE.name,
    predictedTimeS: predictions.at(-1)?.predictedTimeS ?? null,
  };
}
