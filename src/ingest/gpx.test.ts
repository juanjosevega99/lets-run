import { describe, expect, it } from "vitest";
import { parseGpx } from "./gpx.js";

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="StravaGPX" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns="http://www.topografix.com/GPX/1/1">
 <trk>
  <name>Test run</name>
  <trkseg>
   <trkpt lat="-33.4372" lon="-70.6506">
    <ele>520.4</ele>
    <time>2024-03-10T12:00:00Z</time>
    <extensions>
     <gpxtpx:TrackPointExtension>
      <gpxtpx:hr>140</gpxtpx:hr>
     </gpxtpx:TrackPointExtension>
    </extensions>
   </trkpt>
   <trkpt lat="-33.4372" lon="-70.6494">
    <ele>521.0</ele>
    <time>2024-03-10T12:00:30Z</time>
    <extensions>
     <gpxtpx:TrackPointExtension>
      <gpxtpx:hr>145</gpxtpx:hr>
     </gpxtpx:TrackPointExtension>
    </extensions>
   </trkpt>
   <trkpt lat="-33.4372" lon="-70.6482">
    <ele>522.5</ele>
    <time>2024-03-10T12:01:00Z</time>
   </trkpt>
  </trkseg>
 </trk>
</gpx>`;

describe("parseGpx", () => {
  const s = parseGpx(GPX);

  it("produces one entry per track point across all streams", () => {
    expect(s.timeS).toHaveLength(3);
    expect(s.distanceM).toHaveLength(3);
    expect(s.altitudeM).toHaveLength(3);
    expect(s.heartrate).toHaveLength(3);
  });

  it("makes time relative to the first point", () => {
    expect(s.timeS).toEqual([0, 30, 60]);
  });

  it("computes cumulative haversine distance", () => {
    // ~0.0012 deg longitude at lat -33.44 ≈ 111 m per step
    expect(s.distanceM[0]).toBe(0);
    expect(s.distanceM[1]).toBeGreaterThan(100);
    expect(s.distanceM[1]).toBeLessThan(125);
    expect(s.distanceM[2]).toBeCloseTo((s.distanceM[1] as number) * 2, 0);
  });

  it("reads elevation and namespaced heart rate, null when missing", () => {
    expect(s.altitudeM).toEqual([520.4, 521.0, 522.5]);
    expect(s.heartrate).toEqual([140, 145, null]);
  });

  it("returns empty streams for a GPX without points", () => {
    const empty = parseGpx(`<gpx xmlns="http://www.topografix.com/GPX/1/1"></gpx>`);
    expect(empty.timeS).toHaveLength(0);
  });
});
