import type { Sql } from "../db.js";
import type { Streams } from "../ingest/types.js";
import type { ActivitySummary, RaceSummary, TrainingHistory } from "./types.js";

/**
 * Builds the world-as-of-cutoff a predictor sees: activities strictly before the
 * cutoff (summaries eager, streams lazy) and races strictly before it. Shared by the
 * F2 backtest (cutoff = each race date) and live prediction (cutoff = now).
 */
export async function loadHistory(sql: Sql, cutoff: Date, allRaces: RaceSummary[]): Promise<TrainingHistory> {
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

/** All races from the DB with gain fallback via the linked activity. */
export async function loadRaces(sql: Sql): Promise<RaceSummary[]> {
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
  >`select r.id, r.name, r.race_date, r.distance_m, r.official_time_s, r.terrain,
           coalesce(r.elevation_gain_m, a.elevation_gain_m) as elevation_gain_m
    from races r
    left join activities a on a.id = r.activity_id
    order by r.race_date`;
  return races.map((r) => ({
    id: r.id,
    name: r.name,
    raceDate: asUtcDate(r.race_date),
    distanceM: r.distance_m,
    officialTimeS: r.official_time_s,
    terrain: r.terrain,
    elevationGainM: r.elevation_gain_m,
  }));
}

/** postgres.js may hand back DATE columns as strings; normalize to midnight-UTC Date. */
export function asUtcDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
}
