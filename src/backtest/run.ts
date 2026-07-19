import "dotenv/config";
import { connect, type Sql } from "../db.js";
import type { Streams } from "../ingest/types.js";
import type { ActivitySummary, RaceSummary, TrainingHistory, Predictor } from "./types.js";
import { predictors } from "./registry.js";
import { signedErrorPct } from "./metrics.js";
import { formatReport, type PredictorReport, type RaceEvaluation } from "./report.js";
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
    const races = await sql<
      {
        id: number;
        name: string;
        race_date: unknown;
        distance_m: number;
        official_time_s: number;
        terrain: "road" | "trail" | "track";
        elevation_gain_m: number | null;
      }[]
    >`select id, name, race_date, distance_m, official_time_s, terrain, elevation_gain_m
      from races order by race_date`;

    if (races.length === 0) {
      console.log("backtest: races table is empty — import races.csv first (npm run races:import).");
      return;
    }
    if (predictors.length === 0) {
      console.log(formatReport([]));
      return;
    }

    const allRaces: RaceSummary[] = races.map((r) => ({
      id: r.id,
      name: r.name,
      raceDate: asUtcDate(r.race_date),
      distanceM: r.distance_m,
      officialTimeS: r.official_time_s,
      terrain: r.terrain,
      elevationGainM: r.elevation_gain_m,
    }));

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

async function loadHistory(sql: Sql, cutoff: Date, allRaces: RaceSummary[]): Promise<TrainingHistory> {
  const rows = await sql<
    {
      id: number;
      name: string;
      sport_type: string;
      start_date: Date;
      distance_m: number | null;
      moving_time_s: number | null;
      elapsed_time_s: number | null;
      elevation_gain_m: number | null;
      avg_hr: number | null;
      max_hr: number | null;
    }[]
  >`select id, name, sport_type, start_date, distance_m, moving_time_s, elapsed_time_s,
           elevation_gain_m, avg_hr, max_hr
    from activities where start_date < ${cutoff} order by start_date`;

  const activities: ActivitySummary[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    sportType: r.sport_type,
    startDate: r.start_date,
    distanceM: r.distance_m,
    movingTimeS: r.moving_time_s,
    elapsedTimeS: r.elapsed_time_s,
    elevationGainM: r.elevation_gain_m,
    avgHr: r.avg_hr,
    maxHr: r.max_hr,
  }));

  return {
    cutoff,
    activities,
    priorRaces: allRaces.filter((r) => r.raceDate.getTime() < cutoff.getTime()),
    getStreams: async (activityId: number): Promise<Streams | null> => {
      const s = await sql<
        {
          time_s: number[];
          distance_m: (number | null)[] | null;
          altitude_m: (number | null)[] | null;
          heartrate: (number | null)[] | null;
        }[]
      >`select time_s, distance_m, altitude_m, heartrate from activity_streams
        where activity_id = ${activityId}`;
      const row = s[0];
      if (!row) return null;
      return {
        timeS: row.time_s,
        distanceM: row.distance_m ?? row.time_s.map(() => null),
        altitudeM: row.altitude_m ?? row.time_s.map(() => null),
        heartrate: (row.heartrate ?? row.time_s.map(() => null)) as (number | null)[],
      };
    },
  };
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

/** postgres.js may hand back DATE columns as strings; normalize to midnight-UTC Date. */
function asUtcDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
