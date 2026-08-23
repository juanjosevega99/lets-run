import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { connect } from "../db.js";
import { layout } from "./layout.js";
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
  zoneReport,
} from "./queries.js";
import { reviewCutoffForReplan } from "../plan/context.js";
import { renderNow } from "./pages/now.js";
import { renderWeek } from "./pages/week.js";
import { renderTrajectory } from "./pages/trajectory.js";
import { renderZones } from "./pages/zones.js";

/**
 * The athlete dashboard: overview, adaptive weekly plan, and progress.
 *
 *   npm run web            # http://localhost:3000
 *
 */
const PORT = Number(process.env.PORT ?? 3000);
const sql = connect();

/**
 * Guards against concurrent refreshes — the pipeline writes to activities /
 * fitness_state / plan_week, and two overlapping runs would race on all three.
 * In-memory is sufficient: single user, single process.
 */
let refreshInFlight = false;

export async function requestHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader("cache-control", "private, no-store");

  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  // Vercel rewrites preserve the public route in ?path=... while local requests
  // continue to use their normal pathname.
  const path = requestUrl.searchParams.get("path") ?? requestUrl.pathname;

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
}

async function route(path: string): Promise<string | null> {
  const now = new Date();
  const coachingWeek = reviewCutoffForReplan(now);
  switch (path) {
    case "/": {
      const [predictions, fitness, snapshot, latest, races, plan] = await Promise.all([
        livePredictions(sql),
        latestFitness(sql),
        recentSnapshot(sql, 28),
        latestActivityDate(sql),
        allRaces(sql),
        latestPlan(sql, coachingWeek),
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
          plan,
          now,
          tz: dashboardTz(),
        }),
      );
    }
    case "/week": {
      const plan = await latestPlan(sql, coachingWeek);
      // Show actuals from the same dates as the displayed prescription. Previously
      // a future plan could sit beside the current calendar week's activities.
      const activities = plan ? await activitiesForWeek(sql, plan.weekStart) : await thisWeekActivities(sql);
      return layout(
        "lets-run · plan week",
        "/week",
        renderWeek({ activities, plan, tz: dashboardTz() }),
      );
    }
    case "/zones": {
      const report = await zoneReport(sql);
      return layout("lets-run · zones", "/zones", renderZones({ report, tz: dashboardTz() }));
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

const server = createServer(requestHandler);
const isMainModule = process.argv[1] != null && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMainModule) {
  server.listen(PORT, () => {
    console.log(`lets-run web → http://localhost:${PORT}  (${RACE.bracket}, ${daysToRace(new Date())} days to race)`);
  });
}
