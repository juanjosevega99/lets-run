import { describe, expect, it } from "vitest";
import { parseTcx } from "./tcx.js";

// Two laps, so the parser must flatten trackpoints across laps in order.
// Lap 1 is an outdoor run (position + altitude + cumulative distance + HR);
// the last point drops HR to exercise the null case.
const RUN_TCX = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
 <Activities>
  <Activity Sport="Running">
   <Id>2021-05-01T12:00:00Z</Id>
   <Lap StartTime="2021-05-01T12:00:00Z">
    <Track>
     <Trackpoint>
      <Time>2021-05-01T12:00:00Z</Time>
      <Position><LatitudeDegrees>-33.4372</LatitudeDegrees><LongitudeDegrees>-70.6506</LongitudeDegrees></Position>
      <AltitudeMeters>520.0</AltitudeMeters>
      <DistanceMeters>0.0</DistanceMeters>
      <HeartRateBpm><Value>135</Value></HeartRateBpm>
     </Trackpoint>
     <Trackpoint>
      <Time>2021-05-01T12:00:10Z</Time>
      <Position><LatitudeDegrees>-33.4372</LatitudeDegrees><LongitudeDegrees>-70.6494</LongitudeDegrees></Position>
      <AltitudeMeters>522.5</AltitudeMeters>
      <DistanceMeters>111.2</DistanceMeters>
      <HeartRateBpm><Value>142</Value></HeartRateBpm>
     </Trackpoint>
    </Track>
   </Lap>
   <Lap StartTime="2021-05-01T12:00:20Z">
    <Track>
     <Trackpoint>
      <Time>2021-05-01T12:00:20Z</Time>
      <Position><LatitudeDegrees>-33.4372</LatitudeDegrees><LongitudeDegrees>-70.6482</LongitudeDegrees></Position>
      <AltitudeMeters>525.0</AltitudeMeters>
      <DistanceMeters>222.4</DistanceMeters>
     </Trackpoint>
    </Track>
   </Lap>
  </Activity>
 </Activities>
</TrainingCenterDatabase>`;

describe("parseTcx", () => {
  const s = parseTcx(RUN_TCX);

  it("flattens trackpoints across laps into one entry per point", () => {
    expect(s.timeS).toHaveLength(3);
    expect(s.distanceM).toHaveLength(3);
    expect(s.altitudeM).toHaveLength(3);
    expect(s.heartrate).toHaveLength(3);
  });

  it("makes time relative to the first point, across lap boundaries", () => {
    expect(s.timeS).toEqual([0, 10, 20]);
  });

  it("uses the cumulative DistanceMeters channel directly", () => {
    expect(s.distanceM).toEqual([0, 111.2, 222.4]);
  });

  it("reads altitude and heart rate, null where HR is absent", () => {
    expect(s.altitudeM).toEqual([520.0, 522.5, 525.0]);
    expect(s.heartrate).toEqual([135, 142, null]);
  });

  it("falls back to haversine distance when DistanceMeters is missing but GPS exists", () => {
    const noDistance = RUN_TCX.replace(/<DistanceMeters>[\d.]+<\/DistanceMeters>/g, "");
    const d = parseTcx(noDistance).distanceM;
    expect(d[0]).toBe(0);
    expect(d[1]).toBeGreaterThan(100);
    expect(d[1]).toBeLessThan(125);
    expect(d[2]).toBeCloseTo((d[1] as number) * 2, 0);
  });

  it("handles an HR-only trainer file (no position/altitude/distance)", () => {
    const hrOnly = `<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
     <Activities><Activity Sport="Biking"><Lap><Track>
      <Trackpoint><Time>2023-07-10T11:49:28Z</Time><HeartRateBpm><Value>139</Value></HeartRateBpm></Trackpoint>
      <Trackpoint><Time>2023-07-10T11:49:38Z</Time><HeartRateBpm><Value>140</Value></HeartRateBpm></Trackpoint>
     </Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
    const s2 = parseTcx(hrOnly);
    expect(s2.timeS).toEqual([0, 10]);
    expect(s2.heartrate).toEqual([139, 140]);
    expect(s2.distanceM).toEqual([null, null]);
    expect(s2.altitudeM).toEqual([null, null]);
  });

  it("returns empty streams for a TCX without trackpoints", () => {
    const empty = parseTcx(`<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities></Activities></TrainingCenterDatabase>`);
    expect(empty.timeS).toHaveLength(0);
  });
});
