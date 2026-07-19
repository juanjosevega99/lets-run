import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { connect } from "../db.js";
import { layout } from "./layout.js";
import { isAuthorized } from "./auth.js";
import { RACE, daysToRace } from "../lib/race.js";
import {
  allRaces,
  dashboardTz,
  latestActivityDate,
  latestFitness,
  latestPlan,
  livePredictions,
  peakEraWeeklyAvgKm,
  recentSnapshot,
  thisWeekActivities,
  weeklyRunVolume,
} from "./queries.js";
import { renderNow } from "./pages/now.js";
import { renderWeek } from "./pages/week.js";
import { renderTrajectory } from "./pages/trajectory.js";

/**
 * The dashboard (PRD F-C, functional-not-polished): three screens over live data.
 *
 *   npm run web            # http://localhost:3000
 *
 * Set DASHBOARD_PASSWORD to enable the single-user gate — required before deploying
 * anywhere public, optional locally.
 */
const PORT = Number(process.env.PORT ?? 3000);
const PASSWORD = process.env.DASHBOARD_PASSWORD;
const sql = connect();

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (PASSWORD && !isAuthorized(req.headers.authorization, PASSWORD)) {
    res.writeHead(401, {
      "www-authenticate": 'Basic realm="lets-run"',
      "content-type": "text/plain",
    });
    res.end("auth required");
    return;
  }

  const path = (req.url ?? "/").split("?")[0];
  try {
    const body = await route(path ?? "/");
    if (body === null) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(body);
  } catch (err) {
    console.error(err);
    res.writeHead(500, { "content-type": "text/plain" });
    res.end(`error: ${(err as Error).message}`);
  }
});

async function route(path: string): Promise<string | null> {
  const now = new Date();
  switch (path) {
    case "/": {
      const [predictions, fitness, snapshot, latest, races] = await Promise.all([
        livePredictions(sql),
        latestFitness(sql),
        recentSnapshot(sql, 28),
        latestActivityDate(sql),
        allRaces(sql),
      ]);
      return layout(
        "lets-run · now",
        "/",
        renderNow({
          daysToRace: daysToRace(now),
          latestPrediction: predictions.at(-1) ?? null,
          fitness,
          snapshot,
          latestActivityDate: latest,
          races,
          now,
        }),
      );
    }
    case "/week": {
      const [activities, plan] = await Promise.all([thisWeekActivities(sql), latestPlan(sql)]);
      return layout(
        "lets-run · this week",
        "/week",
        renderWeek({ activities, plan, tz: dashboardTz() }),
      );
    }
    case "/trajectory": {
      const [weeks, peakAvgKm, predictions] = await Promise.all([
        weeklyRunVolume(sql, 52),
        peakEraWeeklyAvgKm(sql),
        livePredictions(sql),
      ]);
      return layout(
        "lets-run · trajectory",
        "/trajectory",
        renderTrajectory({ weeks, peakAvgKm, predictions }),
      );
    }
    default:
      return null;
  }
}

server.listen(PORT, () => {
  console.log(`lets-run web → http://localhost:${PORT}  (${RACE.bracket}, ${daysToRace(new Date())} days to race)`);
  if (!PASSWORD) console.log("DASHBOARD_PASSWORD not set — auth gate off (fine locally, required before deploy)");
});
