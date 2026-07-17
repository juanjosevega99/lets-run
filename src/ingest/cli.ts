import "dotenv/config";
import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { gunzipSync } from "node:zlib";
import { connect } from "../db.js";
import { parseActivitiesCsv } from "./activitiesCsv.js";
import { parseGpx } from "./gpx.js";
import { parseFit } from "./fit.js";
import { parseTcx } from "./tcx.js";
import { upsertActivity, upsertStreams } from "./load.js";
import type { Streams } from "./types.js";

/**
 * F0a backfill: ingest an UNZIPPED Strava bulk export directory.
 *
 *   npm run ingest:export -- /path/to/strava-export
 *
 * Expects <dir>/activities.csv plus the <dir>/activities/*.{gpx,fit.gz,tcx.gz} files
 * it references. Idempotent: re-running upserts, so a fixed parser just needs a re-run.
 */
async function main() {
  const exportDir = process.argv[2];
  if (!exportDir) {
    console.error("usage: npm run ingest:export -- /path/to/strava-export");
    process.exit(1);
  }

  const csv = await readFile(join(exportDir, "activities.csv"), "utf8");
  const activities = parseActivitiesCsv(csv);
  console.log(`activities.csv: ${activities.length} activities`);

  const sql = connect();
  const counts = { activities: 0, streams: 0, noFile: 0, unsupported: 0, failed: 0 };
  const unsupportedExts = new Map<string, number>();

  try {
    for (const meta of activities) {
      await upsertActivity(sql, meta, "bulk_export");
      counts.activities++;

      if (!meta.filename) {
        counts.noFile++;
        continue;
      }

      try {
        const streams = await parseTrackFile(exportDir, meta.filename);
        if (streams) {
          await upsertStreams(sql, meta.id, streams);
          counts.streams++;
        } else {
          counts.unsupported++;
          const ext = extensionOf(meta.filename);
          unsupportedExts.set(ext, (unsupportedExts.get(ext) ?? 0) + 1);
        }
      } catch (err) {
        counts.failed++;
        console.error(`  ! ${meta.filename} (${meta.id}): ${(err as Error).message}`);
      }

      if (counts.activities % 200 === 0) {
        console.log(`  ...${counts.activities}/${activities.length}`);
      }
    }
  } finally {
    await sql.end();
  }

  console.log("\ndone:");
  console.log(`  activities upserted: ${counts.activities}`);
  console.log(`  with streams:        ${counts.streams}`);
  console.log(`  no track file:       ${counts.noFile} (gym etc.)`);
  console.log(`  unsupported format:  ${counts.unsupported}`);
  for (const [ext, n] of unsupportedExts) console.log(`    ${ext}: ${n}`);
  console.log(`  failed to parse:     ${counts.failed}`);
}

/** Returns null for formats we don't parse yet (e.g. .tcx) — counted, not fatal. */
async function parseTrackFile(exportDir: string, filename: string): Promise<Streams | null> {
  let buffer = await readFile(join(exportDir, filename));
  let name = basename(filename);

  if (name.endsWith(".gz")) {
    buffer = gunzipSync(buffer);
    name = name.slice(0, -3);
  }

  if (name.endsWith(".gpx")) return parseGpx(buffer.toString("utf8"));
  if (name.endsWith(".fit")) return parseFit(buffer);
  if (name.endsWith(".tcx")) return parseTcx(buffer.toString("utf8"));
  return null;
}

function extensionOf(filename: string): string {
  const name = basename(filename);
  const parts = name.split(".");
  return parts.length > 1 ? `.${parts.slice(1).join(".")}` : "(none)";
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
