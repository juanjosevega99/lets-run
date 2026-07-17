import "dotenv/config";
import { connect } from "../db.js";
import { upsertActivity, upsertStreams } from "../ingest/load.js";
import { refreshAccessToken } from "./oauth.js";
import { fetchActivities, fetchStreams, mapSummaryActivity } from "./api.js";

const OVERLAP_BUFFER_S = 24 * 60 * 60;
const FALLBACK_LOOKBACK_S = 30 * 24 * 60 * 60;

/**
 * F0b incremental sync: pulls activities newer than the latest one already in the
 * DB. Assumes F0a (bulk export) already did the historical backfill — if the table
 * is empty, this only looks back 30 days rather than silently re-doing F0a's job.
 *
 *   npm run strava:sync
 */
async function main() {
  const clientId = requireEnv("STRAVA_CLIENT_ID");
  const clientSecret = requireEnv("STRAVA_CLIENT_SECRET");
  const refreshToken = requireEnv("STRAVA_REFRESH_TOKEN");

  const tokens = await refreshAccessToken(clientId, clientSecret, refreshToken);
  if (tokens.refreshToken !== refreshToken) {
    console.warn(
      "Strava issued a new refresh token; update STRAVA_REFRESH_TOKEN in .env or the next sync will fail.",
    );
  }

  const sql = connect();
  try {
    const [row] = await sql<{ max: Date | null }[]>`select max(start_date) as max from activities`;
    const watermarkS = row?.max
      ? Math.floor(row.max.getTime() / 1000) - OVERLAP_BUFFER_S
      : Math.floor(Date.now() / 1000) - FALLBACK_LOOKBACK_S;

    if (!row?.max) {
      console.warn("No activities in DB yet — defaulting to a 30-day lookback. Run F0a bulk export first for full history.");
    }

    const activities = await fetchActivities(tokens.accessToken, watermarkS);
    console.log(`fetched ${activities.length} activities since ${new Date(watermarkS * 1000).toISOString()}`);

    let withStreams = 0;
    for (const a of activities) {
      const meta = mapSummaryActivity(a);
      await upsertActivity(sql, meta, "api");

      const streams = await fetchStreams(tokens.accessToken, a.id);
      if (streams) {
        await upsertStreams(sql, a.id, streams);
        withStreams++;
      }
    }

    console.log(`done: ${activities.length} upserted, ${withStreams} with streams`);
  } finally {
    await sql.end();
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set in .env (run \`npm run strava:auth\` first)`);
  return v;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
