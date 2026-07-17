import type { Sql } from "../db.js";
import type { ActivityFacts, RaceFacts } from "./buildProfile.js";

/**
 * Loads the facts buildProfile() needs. The per-stream "has real data" checks run in SQL
 * (unnest + count non-null) so the large stream arrays never leave Postgres. An all-null
 * channel — e.g. a run recorded without a heart-rate strap — correctly counts as absent.
 * Shared by the CLI profiler and the web dashboard.
 */
export async function loadProfileFacts(
  sql: Sql,
): Promise<{ activities: ActivityFacts[]; races: RaceFacts[] }> {
  const rows = await sql<
    {
      id: number;
      sport_type: string;
      start_date: Date;
      has_streams: boolean;
      has_hr: boolean;
      has_altitude: boolean;
      has_distance: boolean;
    }[]
  >`
    select
      a.id,
      a.sport_type,
      a.start_date,
      s.activity_id is not null as has_streams,
      coalesce((select count(*) from unnest(s.heartrate)  x where x is not null), 0) > 0 as has_hr,
      coalesce((select count(*) from unnest(s.altitude_m) x where x is not null), 0) > 0 as has_altitude,
      coalesce((select count(*) from unnest(s.distance_m) x where x is not null), 0) > 0 as has_distance
    from activities a
    left join activity_streams s on s.activity_id = a.id
  `;

  const raceRows = await sql<{ id: number; activity_id: number | null }[]>`
    select id, activity_id from races
  `;

  return {
    activities: rows.map((r) => ({
      id: r.id,
      sportType: r.sport_type,
      startDate: r.start_date,
      hasStreams: r.has_streams,
      hasHr: r.has_hr,
      hasAltitude: r.has_altitude,
      hasDistanceStream: r.has_distance,
    })),
    races: raceRows.map((r) => ({ id: r.id, activityId: r.activity_id })),
  };
}
