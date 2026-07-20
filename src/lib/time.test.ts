import { describe, expect, it } from "vitest";
import { dateInTimeZone, formatDuration, formatPace, isoDate } from "./time.js";

describe("formatDuration", () => {
  it("renders h:mm:ss above an hour and m:ss below", () => {
    expect(formatDuration(5834)).toBe("1:37:14");
    expect(formatDuration(2540)).toBe("42:20");
    expect(formatDuration(59)).toBe("0:59");
  });
  it("rounds fractional seconds", () => {
    expect(formatDuration(3599.6)).toBe("1:00:00");
  });
});

describe("formatPace", () => {
  it("computes min/km", () => {
    expect(formatPace(21097.5, 5834)).toBe("4:37/km"); // the bracket-winning pace
    expect(formatPace(10000, 2540)).toBe("4:14/km");
  });
  it("carries the 60-second rollover", () => {
    expect(formatPace(1000, 299.7)).toBe("5:00/km");
  });
  it("returns null when not computable", () => {
    expect(formatPace(null, 100)).toBeNull();
    expect(formatPace(1000, null)).toBeNull();
    expect(formatPace(0, 100)).toBeNull();
  });
});

describe("dateInTimeZone", () => {
  it("uses the athlete-local date instead of UTC", () => {
    expect(dateInTimeZone(new Date("2026-07-20T03:00:00Z"), "America/Bogota")).toBe("2026-07-19");
  });
});

describe("isoDate", () => {
  it("renders UTC YYYY-MM-DD", () => {
    expect(isoDate(new Date("2027-04-24T05:00:00Z"))).toBe("2027-04-24");
  });
});
