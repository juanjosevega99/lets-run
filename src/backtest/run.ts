import "dotenv/config";
import { connect, type Sql } from "../db.js";
import type { RaceSummary, TrainingHistory, Predictor } from "./types.js";
import { predictors } from "./registry.js";
import { signedErrorPct } from "./metrics.js";
import { formatReport, type PredictorReport, type RaceEvaluation } from "./report.js";
import { loadHistory, loadRaces } from "./history.js";
import { isoDate } from "../lib/time.js";

/**
 * F2 backtest: for each race in the backtest set, rebuild the world as it looked the
 * day before, ask every registered predictor for a time, and score it against the
 * official result. Every prediction is persisted to prediction_log with its data
 * cutoff (PRD §4), so the audit trail exists from run one.
 *
 *   npm run backtest
 *
 * Leak-proofing: history is strictly `start_date < race_date` (race_date is a DATE, so
 * the comparison cutoff is midnight UTC of race day — race-morning activities are out),
 * and prior races are strictly earlier races only.
 */
async function main() {
  const sql = connect();
  try {
    const allRaces = await loadRaces(sql);
    if (allRaces.length === 0) {
      console.log("backtest: races table is empty — import races.csv first (npm run races:import).");
      return;
    }
    if (predictors.length === 0) {
      console.log(formatReport([]));
      return;
    }

    const reports: PredictorReport[] = [];
    for (const predictor of predictors) {
      const evaluations: RaceEvaluation[] = [];
      for (const race of allRaces) {
        const history = await loadHistory(sql, race.raceDate, allRaces);
        const evaluation = await evaluateRace(predictor, history, race);
        evaluations.push(evaluation);
        await logPrediction(sql, predictor.name, race, evaluation);
      }
      reports.push({ predictor: predictor.name, evaluations });
    }

    console.log(formatReport(reports));
  } finally {
    await sql.end();
  }
}

async function evaluateRace(
  predictor: Predictor,
  history: TrainingHistory,
  race: RaceSummary,
): Promise<RaceEvaluation> {
  const base = {
    raceName: race.name,
    raceDate: isoDate(race.raceDate),
    distanceKm: race.distanceM / 1000,
    actualS: race.officialTimeS,
  };
  try {
    const result = await predictor.predict(history, {
      distanceM: race.distanceM,
      terrain: race.terrain,
      elevationGainM: race.elevationGainM,
      raceDate: race.raceDate,
    });
    return {
      ...base,
      predictedS: result.timeS,
      errorPct: signedErrorPct(result.timeS, race.officialTimeS),
      note: result.note,
    };
  } catch (err) {
    return { ...base, predictedS: null, errorPct: null, failure: (err as Error).message };
  }
}

async function logPrediction(
  sql: Sql,
  predictorName: string,
  race: RaceSummary,
  e: RaceEvaluation,
): Promise<void> {
  if (e.predictedS === null) return; // failures are reported, not logged as predictions
  await sql`
    insert into prediction_log (data_cutoff, race_id, race_distance_m, predicted_time_s, predictor, context)
    values (
      ${isoDate(race.raceDate)}, ${race.id}, ${race.distanceM}, ${e.predictedS}, ${predictorName},
      ${sql.json({ backtest: true, actual_time_s: e.actualS, error_pct: e.errorPct, note: e.note ?? null })}
    )
  `;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
