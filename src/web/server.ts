import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { connect } from "../db.js";
import { layout } from "./layout.js";
import { isAuthorized } from "./auth.js";
import { RACE, daysToRace } from "../lib/race.js";
import { runRefresh } from "../pipeline/refresh.js";
import {
  allRaces,
  dashboardTz,
  latestActivityDate,
  latestFitness,
  latestPlan,
  livePredictions,
  peakEraWeeklyAvgKm,
  recentSnapshot,
  activitiesForWeek,
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

/**
 * Guards against concurrent refreshes — the pipeline writes to activities /
 * fitness_state / plan_week, and two overlapping runs would race on all three.
 * In-memory is sufficient: single user, single process.
 */
let refreshInFlight = false;

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

  // The one write endpoint: sync → fitness → plan. POST only, so a stray GET
  // (prefetch, crawler, refresh) can never mutate training data.
  if (path === "/actions/refresh") {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json", allow: "POST" });
      res.end(JSON.stringify({ ok: false, error: "POST required" }));
      return;
    }
    if (refreshInFlight) {
      res.writeHead(409, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "a refresh is already running" }));
      return;
    }
    refreshInFlight = true;
    try {
      const result = await runRefresh(sql);
      res.writeHead(result.ok ? 200 : 500, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error(err);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: (err as Error).message }));
    } finally {
      refreshInFlight = false;
    }
    return;
  }

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
          tz: dashboardTz(),
        }),
      );
    }
    case "/week": {
      const plan = await latestPlan(sql);
      // Show actuals from the same dates as the displayed prescription. Previously
      // a future plan could sit beside the current calendar week's activities.
      const activities = plan ? await activitiesForWeek(sql, plan.weekStart) : await thisWeekActivities(sql);
      return layout(
        "lets-run · plan week",
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
        renderTrajectory({ weeks, peakAvgKm, predictions, tz: dashboardTz() }),
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
