import type { Sql } from "../db.js";
import { upsertActivity, upsertStreams } from "../ingest/load.js";
import { refreshAccessToken } from "./oauth.js";
import { fetchActivities, fetchStreams, mapSummaryActivity } from "./api.js";

const OVERLAP_BUFFER_S = 24 * 60 * 60;
const FALLBACK_LOOKBACK_S = 30 * 24 * 60 * 60;

/** Sink for progress lines — console.log from the CLI, an array from the web action. */
export type Log = (line: string) => void;

export interface SyncResult {
  fetched: number;
  withStreams: number;
}

/**
 * F0b incremental sync core. Does NOT close `sql` — the caller owns the connection,
 * so the web server can chain several actions on one connection.
 */
export async function syncStrava(sql: Sql, log: Log): Promise<SyncResult> {
  const clientId = requireEnv("STRAVA_CLIENT_ID");
  const clientSecret = requireEnv("STRAVA_CLIENT_SECRET");
  const refreshToken = requireEnv("STRAVA_REFRESH_TOKEN");

  const tokens = await refreshAccessToken(clientId, clientSecret, refreshToken);
  if (tokens.refreshToken !== refreshToken) {
    log("WARNING: Strava issued a new refresh token; update STRAVA_REFRESH_TOKEN in .env or the next sync will fail.");
  }

  const [row] = await sql<{ max: Date | null }[]>`select max(start_date) as max from activities`;
  const watermarkS = row?.max
    ? Math.floor(row.max.getTime() / 1000) - OVERLAP_BUFFER_S
    : Math.floor(Date.now() / 1000) - FALLBACK_LOOKBACK_S;

  if (!row?.max) {
    log("WARNING: no activities in DB yet — defaulting to a 30-day lookback. Run the bulk export first for full history.");
  }

  const activities = await fetchActivities(tokens.accessToken, watermarkS);
  log(`fetched ${activities.length} activities since ${new Date(watermarkS * 1000).toISOString().slice(0, 10)}`);

  let withStreams = 0;
  for (const a of activities) {
    await upsertActivity(sql, mapSummaryActivity(a), "api");
    const streams = await fetchStreams(tokens.accessToken, a.id);
    if (streams) {
      await upsertStreams(sql, a.id, streams);
      withStreams++;
    }
  }

  log(`sync done: ${activities.length} upserted, ${withStreams} with streams`);
  return { fetched: activities.length, withStreams };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in .env (run \`npm run strava:auth\` first)`);
  return v;
}
