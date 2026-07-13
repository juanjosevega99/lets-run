import { Decoder, Stream } from "@garmin/fitsdk";
import type { Streams } from "./types.js";

/**
 * Decodes a FIT file (device uploads in the Strava export come as .fit.gz) into streams.
 * FIT record messages already carry cumulative distance and (enhanced) altitude,
 * so unlike GPX nothing needs to be derived here.
 */
export function parseFit(buffer: Buffer): Streams {
  const stream = Stream.fromBuffer(buffer);
  const decoder = new Decoder(stream);
  if (!decoder.isFIT() || !decoder.checkIntegrity()) {
    throw new Error("not a valid FIT file");
  }

  const { messages, errors } = decoder.read();
  if (errors.length > 0) {
    throw new Error(`FIT decode errors: ${errors.map((e: unknown) => String(e)).join("; ")}`);
  }

  const records: any[] = messages.recordMesgs ?? [];
  const streams: Streams = { timeS: [], distanceM: [], altitudeM: [], heartrate: [] };
  if (records.length === 0) return streams;

  let t0: number | null = null;
  for (const rec of records) {
    const ts: Date | undefined = rec.timestamp;
    if (!ts) continue;
    const t = ts.getTime();
    if (t0 === null) t0 = t;

    streams.timeS.push(Math.round((t - t0) / 1000));
    streams.distanceM.push(finiteOrNull(rec.distance));
    streams.altitudeM.push(finiteOrNull(rec.enhancedAltitude ?? rec.altitude));
    streams.heartrate.push(finiteOrNull(rec.heartRate));
  }
  return streams;
}

function finiteOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
