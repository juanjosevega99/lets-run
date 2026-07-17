import { XMLParser } from "fast-xml-parser";
import type { Streams } from "./types.js";
import { haversineM } from "./geo.js";

/**
 * Parses a Garmin TCX file (TrainingCenterDatabase v2) into parallel streams.
 * In this Strava export, TCX is the dominant format for 2019–2021 activities —
 * including the 2021–2022 peak-year runs — so without this parser those years
 * carry no HR/altitude/GAP data. Ingestion plumbing only; the deterministic layer
 * (GAP/Minetti, Banister) consumes these streams and stays hand-written.
 *
 * Structure: TrainingCenterDatabase > Activities > Activity > Lap[] > Track > Trackpoint[].
 * Every Trackpoint field except <Time> is optional; a trainer ride may carry only HR,
 * an outdoor run adds Position/AltitudeMeters/DistanceMeters. DistanceMeters is already
 * cumulative from the activity start (across laps), so it's used directly; only when it's
 * absent but GPS Position exists do we fall back to haversine — matching gpx.ts.
 */
export function parseTcx(xml: string): Streams {
  const parser = new XMLParser({
    ignoreAttributes: true,
    isArray: (name) => name === "Activity" || name === "Lap" || name === "Track" || name === "Trackpoint",
  });
  const doc = parser.parse(xml);

  const activities = doc?.TrainingCenterDatabase?.Activities?.Activity ?? [];
  const points: any[] = activities.flatMap((act: any) =>
    (act.Lap ?? []).flatMap((lap: any) => (lap.Track ?? []).flatMap((trk: any) => trk.Trackpoint ?? [])),
  );

  const streams: Streams = { timeS: [], distanceM: [], altitudeM: [], heartrate: [] };
  if (points.length === 0) return streams;

  let t0: number | null = null;
  let haversineCum = 0;
  let prev: { lat: number; lon: number } | null = null;

  for (const pt of points) {
    const time = pt.Time ? Date.parse(pt.Time) : NaN;
    if (Number.isNaN(time)) continue; // a point without a timestamp can't join time-series streams
    if (t0 === null) t0 = time;

    let distance: number | null = null;
    if (pt.DistanceMeters !== undefined) {
      distance = finite(Number(pt.DistanceMeters));
    } else if (pt.Position) {
      const lat = Number(pt.Position.LatitudeDegrees);
      const lon = Number(pt.Position.LongitudeDegrees);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        if (prev) haversineCum += haversineM(prev.lat, prev.lon, lat, lon);
        prev = { lat, lon };
        distance = haversineCum;
      }
    }

    streams.timeS.push(Math.round((time - t0) / 1000));
    streams.distanceM.push(distance);
    streams.altitudeM.push(pt.AltitudeMeters !== undefined ? finite(Number(pt.AltitudeMeters)) : null);
    streams.heartrate.push(pt.HeartRateBpm?.Value !== undefined ? finite(Number(pt.HeartRateBpm.Value)) : null);
  }
  return streams;
}

function finite(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}
