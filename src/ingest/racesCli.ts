import "dotenv/config";
import { readFile } from "node:fs/promises";
import { connect } from "../db.js";
import { parseRacesCsv } from "./racesCsv.js";

/**
 * T0: import the hand-maintained race inventory into the races table.
 *
 *   npm run races:import -- races.csv
 *
 * Idempotent on (name, date): re-running after editing the CSV updates rows in place.
 */
async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: npm run races:import -- path/to/races.csv");
    process.exit(1);
  }

  const races = parseRacesCsv(await readFile(path, "utf8"));
  if (races.length === 0) {
    console.error("no races found in CSV (all rows commented out?)");
    process.exit(1);
  }

  const sql = connect();
  try {
    for (const r of races) {
      await sql`
        insert into races (name, race_date, distance_m, official_time_s, terrain, elevation_gain_m, results_url, notes)
        values (${r.name}, ${r.raceDate}, ${r.distanceM}, ${r.officialTimeS}, ${r.terrain}, ${r.elevationGainM}, ${r.resultsUrl}, ${r.notes})
        on conflict (name, race_date) do update set
          distance_m = excluded.distance_m,
          official_time_s = excluded.official_time_s,
          terrain = excluded.terrain,
          elevation_gain_m = excluded.elevation_gain_m,
          results_url = excluded.results_url,
          notes = excluded.notes
      `;
    }
  } finally {
    await sql.end();
  }

  console.log(`imported ${races.length} race(s):`);
  for (const r of races) {
    const km = (r.distanceM / 1000).toFixed(2);
    console.log(`  ${r.raceDate}  ${km}km ${r.terrain.padEnd(5)}  ${fmt(r.officialTimeS)}  ${r.name}`);
  }
}

function fmt(totalS: number): string {
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
