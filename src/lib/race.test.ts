import { describe, expect, it } from "vitest";
import { daysToRace } from "./race.js";

describe("daysToRace", () => {
  it("counts athlete-local calendar days across UTC midnight", () => {
    expect(daysToRace(new Date("2026-07-20T02:00:00Z"), "America/Bogota")).toBe(279);
    expect(daysToRace(new Date("2026-07-20T05:00:00Z"), "America/Bogota")).toBe(278);
  });
});
