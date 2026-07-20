import { describe, expect, it } from "vitest";
import { reviewWeek } from "./review.js";
import type { PlannedSession } from "../deterministic/validator.js";

const key: PlannedSession = { day: 6, title: "Long run", intensity: "low", plannedKm: 4 };
const sessions: PlannedSession[] = [
  { day: 1, title: "Easy", intensity: "low", plannedKm: 3 },
  { day: 3, title: "Easy", intensity: "low", plannedKm: 3 },
  key,
];

describe("reviewWeek", () => {
  it("progresses a completed week", () => {
    const result = reviewWeek({
      sessions,
      keySession: key,
      actualRuns: [
        { day: 1, distanceKm: 3 },
        { day: 3, distanceKm: 3 },
        { day: 6, distanceKm: 4 },
      ],
    });
    expect(result.decision).toBe("PROGRESS");
    expect(result.keyCompleted).toBe(true);
    expect(result.compliancePct).toBe(100);
  });

  it("repeats when the key session was missed even if filler was completed", () => {
    const result = reviewWeek({
      sessions,
      keySession: key,
      actualRuns: [
        { day: 1, distanceKm: 4 },
        { day: 3, distanceKm: 4 },
      ],
    });
    expect(result.decision).toBe("REPEAT");
    expect(result.keyCompleted).toBe(false);
  });

  it("proceeds when the key landed and only filler was missed", () => {
    const result = reviewWeek({
      sessions,
      keySession: key,
      actualRuns: [
        { day: 1, distanceKm: 2 },
        { day: 6, distanceKm: 4 },
      ],
    });
    expect(result.decision).toBe("PROCEED");
  });

  it("deloads on an explicit recovery red flag", () => {
    const result = reviewWeek({ sessions, keySession: key, actualRuns: [], redFlag: true });
    expect(result.decision).toBe("DELOAD");
  });

  it("counts a run moved by one day and never gives extra-volume credit above 100%", () => {
    const result = reviewWeek({
      sessions,
      keySession: key,
      actualRuns: [
        { day: 0, distanceKm: 5 }, // Tuesday easy moved to Monday
        { day: 3, distanceKm: 3 },
        { day: 5, distanceKm: 8 }, // Sunday key moved to Saturday, plus extra distance
      ],
    });
    expect(result.keyCompleted).toBe(true);
    expect(result.completedRunSessions).toBe(3);
    expect(result.compliancePct).toBe(100);
    expect(result.decision).toBe("PROGRESS");
  });
});
