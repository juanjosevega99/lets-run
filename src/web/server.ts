import "dotenv/config";
import { createServer } from "node:http";
import { connect } from "../db.js";
import { buildProfile } from "../profile/buildProfile.js";
import { loadProfileFacts } from "../profile/load.js";
import { renderDashboard, type RaceDisplay } from "./render.js";

/**
 * F2.5 read-only dashboard, served over HTTP so it's viewable in a browser instead of
 * the CLI. The DB secret stays server-side; the browser only ever sees rendered HTML.
 *
 *   npm run web   # then open http://localhost:3000
 *
 * Local-only for now. Deploying this (for phone access) adds one requirement per §11:
 * a single-user password gate, since it would otherwise expose personal data publicly.
 */
const PORT = Number(process.env.PORT ?? 3000);
const sql = connect();

const server = createServer(async (req, res) => {
  if (req.method !== "GET" || (req.url ?? "/") !== "/") {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }
  try {
    const { activities, races } = await loadProfileFacts(sql);
    const profile = buildProfile(activities, races);

    const raceRows = await sql<
      { name: string; race_date: unknown; distance_m: number; official_time_s: number; terrain: string }[]
    >`select name, race_date, distance_m, official_time_s, terrain from races order by race_date`;
    const display: RaceDisplay[] = raceRows.map((r) => ({
      name: r.name,
      raceDate: String(r.race_date).slice(0, 10),
      distanceKm: r.distance_m / 1000,
      officialTimeS: r.official_time_s,
      terrain: r.terrain,
    }));

    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(renderDashboard(profile, display));
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(`error: ${(err as Error).message}`);
  }
});

server.listen(PORT, () => {
  console.log(`lets-run web → http://localhost:${PORT}`);
});
