import { describe, expect, it } from "vitest";
import { Encoder, Profile, Utils } from "@garmin/fitsdk";
import { parseFit } from "./fit.js";

// Round-trip: encode a minimal activity FIT with the official SDK, decode with our parser.
function encodeTestFit(): Buffer {
  const start = Date.parse("2024-03-10T12:00:00Z");
  const encoder = new Encoder();

  encoder.writeMesg({
    mesgNum: Profile.MesgNum.FILE_ID,
    type: "activity",
    manufacturer: "development",
    product: 0,
    timeCreated: Utils.convertDateToDateTime(new Date(start)),
    serialNumber: 1234,
  });

  const points = [
    { offsetS: 0, distance: 0, altitude: 520.4, heartRate: 140 },
    { offsetS: 10, distance: 35.5, altitude: 521.0, heartRate: 145 },
    { offsetS: 20, distance: 71.25, altitude: 522.2, heartRate: 150 },
  ];
  for (const p of points) {
    encoder.writeMesg({
      mesgNum: Profile.MesgNum.RECORD,
      timestamp: Utils.convertDateToDateTime(new Date(start + p.offsetS * 1000)),
      distance: p.distance,
      enhancedAltitude: p.altitude,
      heartRate: p.heartRate,
    });
  }

  return Buffer.from(encoder.close());
}

describe("parseFit", () => {
  const s = parseFit(encodeTestFit());

  it("produces one entry per record across all streams", () => {
    expect(s.timeS).toHaveLength(3);
    expect(s.distanceM).toHaveLength(3);
    expect(s.altitudeM).toHaveLength(3);
    expect(s.heartrate).toHaveLength(3);
  });

  it("makes time relative to the first record", () => {
    expect(s.timeS).toEqual([0, 10, 20]);
  });

  it("reads distance, altitude and heart rate (within FIT field resolution)", () => {
    expect(s.distanceM[1]).toBeCloseTo(35.5, 1); // distance scale: 0.01 m
    expect(s.altitudeM[0]).toBeCloseTo(520.4, 0); // enhanced_altitude scale: 0.2 m
    expect(s.heartrate).toEqual([140, 145, 150]);
  });

  it("rejects non-FIT input", () => {
    expect(() => parseFit(Buffer.from("definitely not a fit file"))).toThrow(/not a valid FIT/);
  });
});
