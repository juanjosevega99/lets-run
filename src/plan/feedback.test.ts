import { describe, expect, it } from "vitest";
import {
  MAX_FEEDBACK_BATCH,
  deriveReadiness,
  parseFeedbackForm,
  parseFeedbackForms,
  type SessionFeedback,
} from "./feedback.js";

function fb(activityId: number, over: Partial<SessionFeedback> = {}): SessionFeedback {
  return {
    activityId,
    rpe: 5,
    painDuring: "none",
    morningSoreness: "normal",
    gymFocus: null,
    lowerBodyDifficulty: null,
    notes: null,
    ...over,
  };
}

describe("deriveReadiness — missing feedback is never a green signal", () => {
  it("confirms readiness when every run is checked in pain-free", () => {
    const r = deriveReadiness([1, 2, 3], [fb(1), fb(2), fb(3)]);
    expect(r.readinessConfirmed).toBe(true);
    expect(r.redFlag).toBe(false);
    expect(r.runsCheckedIn).toBe(3);
    expect(r.runsTotal).toBe(3);
  });

  it("withholds readiness when one run has no check-in", () => {
    const r = deriveReadiness([1, 2, 3], [fb(1), fb(2)]);
    expect(r.readinessConfirmed).toBe(false);
    expect(r.redFlag).toBe(false);
    expect(r.runsCheckedIn).toBe(2);
    expect(r.reasons.join(" ")).toContain("no check-in");
  });

  it("treats mild pain as a hold, not a deload", () => {
    const r = deriveReadiness([1], [fb(1, { painDuring: "mild" })]);
    expect(r.readinessConfirmed).toBe(false);
    expect(r.redFlag).toBe(false);
  });

  it("raises a red flag for significant pain on a GYM session, despite pain-free runs", () => {
    const r = deriveReadiness([1], [fb(1), fb(99, { painDuring: "significant", gymFocus: "lower" })]);
    expect(r.redFlag).toBe(true);
    expect(r.readinessConfirmed).toBe(false);
  });

  it("raises a red flag for unusual next-morning soreness", () => {
    const r = deriveReadiness([1], [fb(1, { morningSoreness: "unusual" })]);
    expect(r.redFlag).toBe(true);
  });

  it("cannot confirm readiness from a week with no runs", () => {
    const r = deriveReadiness([], []);
    expect(r.readinessConfirmed).toBe(false);
    expect(r.reasons.join(" ")).toContain("no runs");
  });

  it("withholds readiness when soreness was left unreported", () => {
    const r = deriveReadiness([1], [fb(1, { morningSoreness: "not_reported" })]);
    expect(r.readinessConfirmed).toBe(false);
    expect(r.redFlag).toBe(false);
  });
});

describe("parseFeedbackForm", () => {
  const parse = (q: string) => parseFeedbackForm(new URLSearchParams(q));

  it("accepts a fully populated check-in", () => {
    const r = parse("activity_id=42&rpe=6&pain_during=none&morning_soreness=normal&gym_focus=lower&lower_body_difficulty=hard&notes=felt+good");
    expect(r).toMatchObject({
      activityId: 42,
      rpe: 6,
      painDuring: "none",
      morningSoreness: "normal",
      gymFocus: "lower",
      lowerBodyDifficulty: "hard",
      notes: "felt good",
    });
  });

  it("defaults everything but the id to not_reported", () => {
    expect(parse("activity_id=42")).toMatchObject({
      activityId: 42,
      rpe: null,
      painDuring: "not_reported",
      morningSoreness: "not_reported",
      gymFocus: null,
      notes: null,
    });
  });

  it("treats whitespace-only notes as absent", () => {
    expect(parse("activity_id=42&notes=%20%20")).toMatchObject({ notes: null });
  });

  for (const [label, query] of [
    ["a missing id", "rpe=5"],
    ["a non-numeric id", "activity_id=abc"],
    ["a zero id", "activity_id=0"],
    ["rpe below range", "activity_id=42&rpe=0"],
    ["rpe above range", "activity_id=42&rpe=11"],
    ["a fractional rpe", "activity_id=42&rpe=2.5"],
    ["an unknown pain level", "activity_id=42&pain_during=agony"],
    ["an unknown soreness level", "activity_id=42&morning_soreness=meh"],
    ["an unknown gym focus", "activity_id=42&gym_focus=cardio"],
    ["an unknown difficulty", "activity_id=42&lower_body_difficulty=brutal"],
  ] as const) {
    it(`rejects ${label}`, () => {
      expect(typeof parse(query)).toBe("string");
    });
  }

  it("rejects notes over the length cap", () => {
    expect(typeof parse(`activity_id=42&notes=${"x".repeat(2001)}`)).toBe("string");
  });
});

describe("parseFeedbackForms — one tap, several runs", () => {
  const parse = (q: string) => parseFeedbackForms(new URLSearchParams(q));

  it("applies one clean answer to every run in the batch", () => {
    const r = parse("activity_ids=1,2,3&pain_during=none&morning_soreness=normal");
    expect(Array.isArray(r)).toBe(true);
    const list = r as SessionFeedback[];
    expect(list.map((f) => f.activityId)).toEqual([1, 2, 3]);
    expect(list.every((f) => f.painDuring === "none" && f.morningSoreness === "normal")).toBe(true);
  });

  it("is still an explicit report — a batch confirms readiness, it does not bypass it", () => {
    const list = parse("activity_ids=1,2,3&pain_during=none&morning_soreness=normal") as SessionFeedback[];
    expect(deriveReadiness([1, 2, 3], list).readinessConfirmed).toBe(true);
    // and a batch that does not cover every run still cannot confirm it
    expect(deriveReadiness([1, 2, 3, 4], list).readinessConfirmed).toBe(false);
  });

  it("a batch reporting pain still raises the red flag", () => {
    const list = parse("activity_ids=1,2&pain_during=significant") as SessionFeedback[];
    expect(deriveReadiness([1, 2], list).redFlag).toBe(true);
  });

  it("de-duplicates repeated ids", () => {
    expect((parse("activity_ids=7,7,8") as SessionFeedback[]).map((f) => f.activityId)).toEqual([7, 8]);
  });

  it("still accepts a single activity_id", () => {
    expect((parse("activity_id=42&rpe=6") as SessionFeedback[])[0]).toMatchObject({ activityId: 42, rpe: 6 });
  });

  it("rejects a batch containing any invalid id", () => {
    expect(typeof parse("activity_ids=1,abc,3")).toBe("string");
    expect(typeof parse("activity_ids=1,-2")).toBe("string");
  });

  it("rejects an oversized batch", () => {
    const ids = Array.from({ length: MAX_FEEDBACK_BATCH + 1 }, (_, i) => i + 1).join(",");
    expect(typeof parse(`activity_ids=${ids}`)).toBe("string");
  });

  it("validates the body once for the whole batch", () => {
    expect(typeof parse("activity_ids=1,2&rpe=99")).toBe("string");
  });
});

