import type { Sql } from "../db.js";
import type { ActivityMeta, Streams } from "./types.js";

export async function upsertActivity(
  sql: Sql,
  meta: ActivityMeta,
  source: "bulk_export" | "api",
): Promise<void> {
  await sql`
    insert into activities (
      id, name, sport_type, start_date,
      elapsed_time_s, moving_time_s, distance_m, elevation_gain_m,
      avg_hr, max_hr, source, source_file, raw
    ) values (
      ${meta.id}, ${meta.name}, ${meta.sportType}, ${meta.startDate},
      ${meta.elapsedTimeS}, ${meta.movingTimeS}, ${meta.distanceM}, ${meta.elevationGainM},
      ${meta.avgHr}, ${meta.maxHr}, ${source}, ${meta.filename}, ${sql.json(meta.raw as any)}
    )
    on conflict (id) do update set
      name = excluded.name,
      sport_type = excluded.sport_type,
      start_date = excluded.start_date,
      elapsed_time_s = excluded.elapsed_time_s,
      moving_time_s = excluded.moving_time_s,
      distance_m = excluded.distance_m,
      elevation_gain_m = excluded.elevation_gain_m,
      avg_hr = excluded.avg_hr,
      max_hr = excluded.max_hr,
      -- bulk_export's raw CSV row carries fields the API doesn't; never let a later
      -- API sync (e.g. the overlap window at the sync watermark) clobber it
      source = case when activities.source = 'bulk_export' then activities.source else excluded.source end,
      source_file = case when activities.source = 'bulk_export' then activities.source_file else excluded.source_file end,
      raw = case when activities.source = 'bulk_export' then activities.raw else excluded.raw end
  `;
}

export async function upsertStreams(sql: Sql, activityId: number, s: Streams): Promise<void> {
  if (s.timeS.length === 0) return;
  await sql`
    insert into activity_streams (activity_id, time_s, distance_m, altitude_m, heartrate)
    values (
      ${activityId},
      ${sql.array(s.timeS)},
      ${sql.array(s.distanceM)},
      ${sql.array(s.altitudeM)},
      ${sql.array(s.heartrate)}
    )
    on conflict (activity_id) do update set
      time_s = excluded.time_s,
      distance_m = excluded.distance_m,
      altitude_m = excluded.altitude_m,
      heartrate = excluded.heartrate
  `;
}
