import type { Sql } from "../db.js";
import type { PlanContext } from "./generate.js";
import { findLimiter } from "../deterministic/limiter.js";
import { trainingPaces, vdotFromRace } from "../deterministic/vdot.js";
import { RACE, daysToRace } from "../lib/race.js";
import { weeklyRunVolume, latestFitness, livePredictions } from "../web/queries.js";

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
  const paces = bestVdot ? trainingPaces(bestVdot) : null;

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
    paces: paces
      ? { easySecPerKm: paces.easySecPerKm, thresholdSecPerKm: paces.thresholdSecPerKm }
      : null,
    daysToRace: daysToRace(new Date()),
    targetTimeS: RACE.targetTimeS,
    raceName: RACE.name,
    predictedTimeS: predictions.at(-1)?.predictedTimeS ?? null,
  };
}
