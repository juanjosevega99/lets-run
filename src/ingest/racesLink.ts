import "dotenv/config";
import { connect } from "../db.js";
import { dateOnly } from "../lib/time.js";

/**
 * Links each race to its Strava activity: same calendar day, running sport, closest
 * distance (within ±25% — race GPS often reads short/long). Gives the backtest access
 * to the activity's elevation gain when races.elevation_gain_m is null (e.g. the 2022
 * mountain half). Idempotent; re-run any time.
 *
 *   npm run races:link
 */
async function main() {
  const sql = connect();
  try {
    const races = await sql<{ id: number; name: string; race_date: unknown; distance_m: number }[]>`
      select id, name, race_date, distance_m from races order by race_date`;

    for (const race of races) {
      const day = dateOnly(race.race_date);
      const candidates = await sql<{ id: number; distance_m: number | null; elevation_gain_m: number | null }[]>`
        select id, distance_m, elevation_gain_m from activities
        where sport_type ilike '%run%'
          and start_date >= ${day}::date and start_date < ${day}::date + interval '1 day'
      `;
      const best = candidates
        .filter((c) => c.distance_m != null && Math.abs(c.distance_m - race.distance_m) / race.distance_m <= 0.25)
        .sort((a, b) => Math.abs(a.distance_m! - race.distance_m) - Math.abs(b.distance_m! - race.distance_m))[0];

      if (best) {
        await sql`update races set activity_id = ${best.id} where id = ${race.id}`;
        console.log(
          `linked: ${day}  ${race.name} → activity ${best.id}` +
            (best.elevation_gain_m != null ? ` (gain ${Math.round(best.elevation_gain_m)}m)` : ""),
        );
      } else {
        console.log(`no match: ${day}  ${race.name} (${candidates.length} run(s) that day)`);
      }
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
