/**
 * Composed race predictors for the F2 backtest and live prediction. Three variants,
 * run side by side so the backtest — not taste — picks the winner:
 *
 *   riegel-v1    reference race → Riegel curve with personally-fitted exponent
 *   vdot-v1      best VDOT among recent prior races → Daniels equivalence
 *   vdot-ctl-v1  vdot-v1 plus a detraining penalty from the Banister CTL ratio
 *                (EXPERIMENTAL: the 0.06 exponent is a modeling guess; the backtest judges)
 *
 * All variants apply the Minetti course factor when elevation gain is known, and a
 * flat trail surface factor (gravel/footing, ~4%, an estimate — Patagonian wind is
 * deliberately NOT modeled; it belongs in the interval, not the point estimate).
 */

import type { Predictor, TrainingHistory, PredictionRequest, RaceSummary } from "../backtest/types.js";
import { riegelPredict, fitRiegelExponent } from "./riegel.js";
import { vdotFromRace, predictTimeS } from "./vdot.js";
import { courseFactor } from "./minetti.js";
import { activityStress, isRunning, type AthleteHrProfile } from "./stress.js";
import { banisterSeries, fillDays } from "./banister.js";

const REFERENCE_WINDOW_MS = 24 * 30.44 * 86_400_000; // ~24 months
export const TRAIL_SURFACE_FACTOR = 1.04;
const DETRAINING_EXPONENT = 0.06;

function terrainFactor(req: PredictionRequest): number {
  const grade = courseFactor(req.distanceM, req.elevationGainM ?? 0);
  const surface = req.terrain === "trail" ? TRAIL_SURFACE_FACTOR : 1;
  return grade * surface;
}

/** Best (highest-VDOT) prior race, preferring the trailing 24 months. */
function referenceRace(history: TrainingHistory): RaceSummary {
  if (history.priorRaces.length === 0) {
    throw new Error("no prior race to extrapolate from");
  }
  const cutoffMs = history.cutoff.getTime();
  const recent = history.priorRaces.filter((r) => cutoffMs - r.raceDate.getTime() <= REFERENCE_WINDOW_MS);
  const pool = recent.length > 0 ? recent : history.priorRaces;
  return pool.reduce((best, r) =>
    vdotFromRace(r.distanceM, r.officialTimeS) > vdotFromRace(best.distanceM, best.officialTimeS) ? r : best,
  );
}

export const riegelPredictor: Predictor = {
  name: "riegel-v1",
  async predict(history, req) {
    const ref = referenceRace(history);
    const exponent = fitRiegelExponent(
      history.priorRaces.map((r) => ({ distanceM: r.distanceM, timeS: r.officialTimeS })),
    );
    const flat = riegelPredict(ref.officialTimeS, ref.distanceM, req.distanceM, exponent);
    return {
      timeS: flat * terrainFactor(req),
      note: `ref ${ref.name} (${(ref.distanceM / 1000).toFixed(1)}k), b=${exponent.toFixed(3)}`,
    };
  },
};

export const vdotPredictor: Predictor = {
  name: "vdot-v1",
  async predict(history, req) {
    const ref = referenceRace(history);
    const vdot = vdotFromRace(ref.distanceM, ref.officialTimeS);
    const flat = predictTimeS(vdot, req.distanceM);
    return { timeS: flat * terrainFactor(req), note: `VDOT ${vdot.toFixed(1)} from ${ref.name}` };
  },
};

export const vdotCtlPredictor: Predictor = {
  name: "vdot-ctl-v1",
  async predict(history, req) {
    const ref = referenceRace(history);
    const vdot = vdotFromRace(ref.distanceM, ref.officialTimeS);
    const flat = predictTimeS(vdot, req.distanceM);

    const { ctlAt } = runningCtl(history);
    const ctlRef = Math.max(5, ctlAt(ref.raceDate)); // floor: near-zero CTL would explode the ratio
    const ctlNow = Math.max(5, ctlAt(history.cutoff));
    const detraining = Math.pow(ctlRef / ctlNow, DETRAINING_EXPONENT);

    return {
      timeS: flat * detraining * terrainFactor(req),
      note: `VDOT ${vdot.toFixed(1)}, CTL ${ctlRef.toFixed(0)}→${ctlNow.toFixed(0)}, ×${detraining.toFixed(3)}`,
    };
  },
};

/** Banister running-CTL over the full history, queryable at any date. */
function runningCtl(history: TrainingHistory): { ctlAt: (d: Date) => number } {
  if (history.activities.length === 0) return { ctlAt: () => 0 };

  const hr = hrProfile(history);
  const refVdot =
    history.priorRaces.length > 0
      ? Math.max(...history.priorRaces.map((r) => vdotFromRace(r.distanceM, r.officialTimeS)))
      : 45; // reasonable recreational default when no race exists yet

  const byDay = new Map<string, { runningStress: number; totalStress: number }>();
  for (const a of history.activities) {
    const day = a.startDate.toISOString().slice(0, 10);
    const s = activityStress(a, hr, refVdot);
    const cur = byDay.get(day) ?? { runningStress: 0, totalStress: 0 };
    cur.totalStress += s.stress;
    if (isRunning(a.sportType)) cur.runningStress += s.stress;
    byDay.set(day, cur);
  }

  const first = history.activities[0]!.startDate.toISOString().slice(0, 10);
  const last = history.cutoff.toISOString().slice(0, 10);
  const series = banisterSeries(fillDays(byDay, first, last));
  const byDate = new Map(series.map((d) => [d.day, d.ctl]));
  const lastCtl = series.at(-1)?.ctl ?? 0;

  return {
    ctlAt: (d: Date) => byDate.get(d.toISOString().slice(0, 10)) ?? lastCtl,
  };
}

function hrProfile(history: TrainingHistory): AthleteHrProfile {
  const observedMax = Math.max(0, ...history.activities.map((a) => a.maxHr ?? 0));
  // clamp: spikes are sensor noise, absence falls back to 220 − age(27)
  const hrMax = observedMax >= 170 && observedMax <= 210 ? observedMax : 193;
  return { hrMax, hrRest: 55 };
}

export const allPredictors: Predictor[] = [riegelPredictor, vdotPredictor, vdotCtlPredictor];
