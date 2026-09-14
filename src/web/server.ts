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
  checkinActivities,
} from "./queries.js";
import { buildPlanContext, reviewCutoffForReplan } from "../plan/context.js";
import { parseFeedbackForm } from "../plan/feedback.js";
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

  // The second write endpoint: one post-session check-in. POST only for the same
  // reason as /actions/refresh — a prefetch or crawler must never write training data.
  if (path === "/actions/checkin") {
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "text/plain", allow: "POST" });
      res.end("POST required");
      return;
    }
    try {
      const raw = await readBody(req);
      if (raw === null) {
        res.writeHead(413, { "content-type": "text/plain" });
        res.end("body too large");
        return;
      }
      const parsed = parseFeedbackForm(new URLSearchParams(raw));
      if (typeof parsed === "string") {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end(parsed);
        return;
      }
      await sql`
        insert into session_feedback (activity_id, rpe, pain_during, morning_soreness,
                                      gym_focus, lower_body_difficulty, notes)
        values (${parsed.activityId}, ${parsed.rpe}, ${parsed.painDuring}, ${parsed.morningSoreness},
                ${parsed.gymFocus}, ${parsed.lowerBodyDifficulty}, ${parsed.notes})
        on conflict (activity_id) do update set
          rpe = excluded.rpe,
          pain_during = excluded.pain_during,
          morning_soreness = excluded.morning_soreness,
          gym_focus = excluded.gym_focus,
          lower_body_difficulty = excluded.lower_body_difficulty,
          notes = excluded.notes,
          updated_at = now()
      `;
      // Post/Redirect/Get: the dashboard is server-rendered, so a reload after saving
      // must not resubmit the form.
      res.writeHead(303, { location: "/week" });
      res.end();
    } catch (err) {
      if ((err as { code?: string }).code === "23503") {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("unknown activity");
        return;
      }
      console.error(err);
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`error: ${(err as Error).message}`);
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

const MAX_BODY_BYTES = 32 * 1024;

/** Collects a urlencoded request body, or null when it exceeds the size cap. */
async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buf.length;
    if (size > MAX_BODY_BYTES) return null;
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
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
      const [activities, checkin] = await Promise.all([
        plan ? activitiesForWeek(sql, plan.weekStart) : thisWeekActivities(sql),
        checkinActivities(sql, 10),
      ]);
      return layout(
        "lets-run · plan week",
        "/week",
        renderWeek({ activities, plan, checkin, tz: dashboardTz() }),
      );
    }
    case "/zones": {
      const report = await zoneReport(sql);
      return layout("lets-run · zones", "/zones", renderZones({ report, tz: dashboardTz() }));
    }
    case "/trajectory": {
      const [weeks, peakAvgKm, predictions, planCtx] = await Promise.all([
        weeklyRunVolume(sql, 52),
        peakEraWeeklyAvgKm(sql),
        livePredictions(sql),
        // The forward model needs the same context the planner uses. A failure here
        // must not take the whole page down — the history above it still stands.
        buildPlanContext(sql).catch(() => null),
      ]);
      return layout(
        "lets-run · trajectory",
        "/trajectory",
        renderTrajectory({
          weeks,
          peakAvgKm,
          predictions,
          trajectory: planCtx?.trajectory ?? null,
          tz: dashboardTz(),
        }),
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
