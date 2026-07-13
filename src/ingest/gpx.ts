import { XMLParser } from "fast-xml-parser";
import type { Streams } from "./types.js";

/**
 * Parses a GPX file (Strava-app recordings export as GPX) into parallel streams.
 * GPX has no distance channel, so cumulative distance is computed with haversine
 * over the GPS track. This is ingestion plumbing, not the domain model — GAP/Minetti
 * consumes these streams but lives in the hand-written deterministic layer.
 */
export function parseGpx(xml: string): Streams {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => name === "trkseg" || name === "trkpt" || name === "trk",
  });
  const doc = parser.parse(xml);

  const tracks = doc?.gpx?.trk ?? [];
  const points: any[] = tracks.flatMap((trk: any) =>
    (trk.trkseg ?? []).flatMap((seg: any) => seg.trkpt ?? []),
  );

  const streams: Streams = { timeS: [], distanceM: [], altitudeM: [], heartrate: [] };
  if (points.length === 0) return streams;

  let t0: number | null = null;
  let cumulative = 0;
  let prev: { lat: number; lon: number } | null = null;

  for (const pt of points) {
    const lat = Number(pt["@_lat"]);
    const lon = Number(pt["@_lon"]);
    const time = pt.time ? Date.parse(pt.time) : NaN;
    if (Number.isNaN(time)) continue; // a point without a timestamp can't join time-series streams
    if (t0 === null) t0 = time;

    if (prev && Number.isFinite(lat) && Number.isFinite(lon)) {
      cumulative += haversineM(prev.lat, prev.lon, lat, lon);
    }
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      prev = { lat, lon };
    }

    streams.timeS.push(Math.round((time - t0) / 1000));
    streams.distanceM.push(prev ? cumulative : null);
    streams.altitudeM.push(pt.ele !== undefined ? Number(pt.ele) : null);
    streams.heartrate.push(extractHr(pt));
  }
  return streams;
}

function extractHr(pt: any): number | null {
  const ext = pt.extensions;
  if (!ext) return null;
  // Namespace prefix varies: gpxtpx:TrackPointExtension/gpxtpx:hr is the common one
  for (const key of Object.keys(ext)) {
    if (!key.toLowerCase().includes("trackpointextension")) continue;
    const tpx = ext[key];
    for (const hrKey of Object.keys(tpx ?? {})) {
      if (hrKey.toLowerCase().endsWith("hr")) {
        const hr = Number(tpx[hrKey]);
        return Number.isFinite(hr) ? hr : null;
      }
    }
  }
  return null;
}

const EARTH_RADIUS_M = 6371000;

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}
