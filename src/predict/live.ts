import type { Sql } from "../db.js";
import { predictors } from "../backtest/registry.js";
import { loadHistory, loadRaces } from "../backtest/history.js";
import { quantile } from "../backtest/metrics.js";
import { RACE, daysToRace } from "../lib/race.js";
import { formatDuration, isoDate } from "../lib/time.js";
import type { Log } from "../strava/sync.js";

export const DEFAULT_LIVE_MODEL = "vdot-ctl-v1";
export const DEFAULT_COURSE_GAIN_M = 250;

export interface LivePredictionOptions {
  modelName?: string;
  courseGainM?: number;
}

/**
 * Computes and stores a current-shape estimate for the goal course. The race date is
 * recorded as context but future training is not modeled, so this must not be called
 * a race-day forecast.
 */
export async function generateLivePrediction(
  sql: Sql,
  log: Log,
  options: LivePredictionOptions = {},
): Promise<void> {
  const modelName = options.modelName ?? DEFAULT_LIVE_MODEL;
  const gain = options.courseGainM ?? DEFAULT_COURSE_GAIN_M;
  const canonical = modelName === DEFAULT_LIVE_MODEL && gain === DEFAULT_COURSE_GAIN_M;
  const predictor = predictors.find((p) => p.name === modelName);
  if (!predictor) {
    throw new Error(`unknown model "${modelName}" — available: ${predictors.map((p) => p.name).join(", ")}`);
  }
  if (!Number.isFinite(gain) || gain < 0) throw new Error(`course gain must be a finite non-negative number`);

  const races = await loadRaces(sql);
  const cutoff = new Date();
  const history = await loadHistory(sql, cutoff, races);
  const result = await predictor.predict(history, {
    distanceM: RACE.distanceM,
    terrain: "trail",
    elevationGainM: gain,
    raceDate: new Date(`${RACE.dateIso}T00:00:00Z`),
  });

  const errors = await backtestErrors(sql, predictor.name);
  let p10: number | null = null;
  let p90: number | null = null;
  if (errors.length >= 3) {
    const sorted = [...errors].sort((a, b) => a - b);
    // err = (pred − actual)/actual → actual = pred/(1 + err/100)
    p10 = result.timeS / (1 + quantile(sorted, 0.9) / 100);
    p90 = result.timeS / (1 + quantile(sorted, 0.1) / 100);
  }

  await sql`
    insert into prediction_log (data_cutoff, race_distance_m, predicted_time_s,
                                interval_p10_s, interval_p90_s, predictor, context)
    values (${isoDate(cutoff)}, ${RACE.distanceM}, ${result.timeS}, ${p10}, ${p90},
            ${predictor.name}, ${sql.json({
              live: true,
              canonical,
              estimate_kind: "current_shape",
              goal_race_date: RACE.dateIso,
              course_gain_m: gain,
              interval_error_n: errors.length,
              note: result.note ?? null,
            })})
  `;

  const gapS = result.timeS - RACE.targetTimeS;
  log(`${RACE.name} · ${daysToRace(cutoff)} days to race`);
  log(`current-shape model ${predictor.name} · course gain ${gain}m · ${result.note ?? ""}`);
  log(`estimated today: ${formatDuration(result.timeS)}`);
  log(
    p10 != null && p90 != null
      ? `historical model-error range: ${formatDuration(p10)}–${formatDuration(p90)} (${errors.length} races)`
      : "historical model-error range unavailable — fewer than 3 backtest errors",
  );
  log(
    gapS <= 0
      ? `${formatDuration(-gapS)} under today's target benchmark`
      : `current-shape gap to ${formatDuration(RACE.targetTimeS)}: ${formatDuration(gapS)}`,
  );
}

/** Latest backtest error per race for this predictor (re-runs overwrite older logs). */
async function backtestErrors(sql: Sql, predictorName: string): Promise<number[]> {
  const rows = await sql<{ error_pct: string | null }[]>`
    select distinct on (race_id) context->>'error_pct' as error_pct
    from prediction_log
    where predictor = ${predictorName} and race_id is not null
    order by race_id, predicted_at desc
  `;
  return rows.map((r) => Number(r.error_pct)).filter((n) => Number.isFinite(n));
}
