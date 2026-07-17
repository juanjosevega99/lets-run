import "dotenv/config";
import { connect } from "../db.js";
import { buildProfile, formatProfile, type ActivityFacts, type RaceFacts } from "./buildProfile.js";

/**
 * Prints a read-only profile of the ingested data:
 *
 *   npm run profile
 *
 * The per-stream "has real data" checks run in SQL (unnest + count non-null) so the
 * large stream arrays never leave Postgres. An all-null HR array — which our GPX parser
 * produces for runs recorded without a heart-rate strap — correctly counts as "no HR".
 */
async function main() {
  const sql = connect();
  try {
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

    const activities: ActivityFacts[] = rows.map((r) => ({
      id: r.id,
      sportType: r.sport_type,
      startDate: r.start_date,
      hasStreams: r.has_streams,
      hasHr: r.has_hr,
      hasAltitude: r.has_altitude,
      hasDistanceStream: r.has_distance,
    }));
    const races: RaceFacts[] = raceRows.map((r) => ({ id: r.id, activityId: r.activity_id }));

    console.log(formatProfile(buildProfile(activities, races)));
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
