import { describe, expect, it } from "vitest";
import { buildWeekTemplate, type WeekTemplateInput } from "./weekTemplate.js";
import { checkCoachProperties, type CoachPropertyInput } from "./coachProperties.js";
import { phaseRunDays } from "./trainingPhase.js";
import { isAllEasyWeek } from "./schedule.js";
import type { PlannedSession } from "./validator.js";
import type { Limiter } from "./limiter.js";
import type { TrainingPhase } from "./trainingPhase.js";
import type { WeekDecision } from "../plan/review.js";

const LIMITERS: Limiter[] = ["aerobic_base", "long_endurance", "threshold", "race_specific"];
const PHASES: TrainingPhase[] = ["return_to_run", "base", "build", "race_specific", "taper"];
const DECISIONS: (WeekDecision | null)[] = [null, "PROGRESS", "PROCEED", "REPEAT", "DELOAD"];

function planFor(over: Partial<WeekTemplateInput> & { preferredRunDays?: number[] }): CoachPropertyInput {
  const { preferredRunDays = [], ...rest } = over;
  const input: WeekTemplateInput = {
    limiter: "aerobic_base",
    limiterReason: "test",
    trainingPhase: "base",
    previousWeekKm: 20,
    recentWeeklyKm: [18, 19, 20],
    tsb: 0,
    aerobicTsb: 0,
    totalAtl: 10,
    totalTsb: 0,
    previousDecision: null,
    runDays: [1, 3, 6],
    strengthDays: [],
    lowerBodyStrengthDays: [],
    longestRunKm30d: 12,
    easyPaceSecPerKm: 400,
    thresholdPaceSecPerKm: 300,
    ...rest,
  };
  const plan = buildWeekTemplate(input);
  const toSession = (s: (typeof plan)["key_session"]): PlannedSession => ({
    day: s.day,
    title: s.title,
    intensity: s.intensity,
    plannedKm: s.planned_km,
    plannedMinutes: s.planned_minutes,
  });
  return {
    sessions: [plan.key_session, ...plan.support_sessions].map(toSession),
    keySession: toSession(plan.key_session),
    trainingPhase: input.trainingPhase,
    previousDecision: input.previousDecision,
    previousWeekKm: input.previousWeekKm,
    recentWeeklyKm: input.recentWeeklyKm,
    longestRunKm30d: input.longestRunKm30d,
    preferredRunDays,
  };
}

describe("the deterministic coach satisfies its own coaching properties", () => {
  for (const trainingPhase of PHASES) {
    for (const limiter of LIMITERS) {
      for (const previousDecision of DECISIONS) {
        for (const previousWeekKm of [null, 8.9, 20, 45]) {
          it(`${trainingPhase}/${limiter}/${previousDecision}/${previousWeekKm}km`, () => {
            const recentWeeklyKm = previousWeekKm == null ? [] : [previousWeekKm * 1.2, previousWeekKm];
            const runDays = phaseRunDays(trainingPhase, [], isAllEasyWeek(trainingPhase, limiter), 12);
            expect(
              checkCoachProperties(
                planFor({ trainingPhase, limiter, previousDecision, previousWeekKm, recentWeeklyKm, runDays }),
              ),
            ).toEqual([]);
          });
        }
      }
    }
  }
});

describe("the properties actually catch the defects that shipped", () => {
  it("catches a key session shorter than the easy runs (C1)", () => {
    const base = planFor({});
    const broken: CoachPropertyInput = {
      ...base,
      keySession: { day: 6, title: "Long run", intensity: "low", plannedKm: 2.6 },
      sessions: [
        { day: 1, title: "Easy run", intensity: "low", plannedKm: 3.1 },
        { day: 3, title: "Easy run", intensity: "low", plannedKm: 3.1 },
        { day: 6, title: "Long run", intensity: "low", plannedKm: 2.6 },
      ],
    };
    expect(checkCoachProperties(broken).map((x) => x.property)).toContain("key_is_the_longest_run");
  });

  it("catches a plan that sank below what the athlete already runs (C2)", () => {
    const base = planFor({});
    const ratcheted: CoachPropertyInput = {
      ...base,
      recentWeeklyKm: [14.4, 5, 4.1, 8.9],
      keySession: { day: 6, title: "Long run", intensity: "low", plannedKm: 1.6 },
      sessions: [
        { day: 1, title: "Easy run", intensity: "low", plannedKm: 1.1 },
        { day: 3, title: "Easy run", intensity: "low", plannedKm: 1.3 },
        { day: 6, title: "Long run", intensity: "low", plannedKm: 1.6 },
      ],
    };
    expect(checkCoachProperties(ratcheted).map((x) => x.property)).toContain("not_below_recent_behavior");
  });

  it("catches prescribing Tue/Thu/Sun to someone who runs Mon/Wed/Sun", () => {
    const mismatched = planFor({ runDays: [1, 3, 6], preferredRunDays: [0, 2, 6] });
    expect(checkCoachProperties(mismatched).map((x) => x.property)).toContain("days_match_the_athletes_week");
  });

  it("catches walk-break copy for a distance already run unbroken", () => {
    const base = planFor({});
    const patronising: CoachPropertyInput = {
      ...base,
      longestRunKm30d: 5.8,
      keySession: { day: 6, title: "Longest easy run/walk", intensity: "low", plannedKm: 5.8 },
      sessions: [{ day: 6, title: "Longest easy run/walk", intensity: "low", plannedKm: 5.8 }],
    };
    expect(checkCoachProperties(patronising).map((x) => x.property)).toContain(
      "copy_matches_demonstrated_capacity",
    );
  });

  it("catches a PROGRESS week that does not progress", () => {
    const base = planFor({});
    const flat: CoachPropertyInput = {
      ...base,
      previousDecision: "PROGRESS",
      previousWeekKm: 20,
      sessions: [{ day: 6, title: "Long run", intensity: "low", plannedKm: 6 }],
      keySession: { day: 6, title: "Long run", intensity: "low", plannedKm: 6 },
      recentWeeklyKm: [],
    };
    expect(checkCoachProperties(flat).map((x) => x.property)).toContain("progress_actually_progresses");
  });
});

describe("the properties do not fire on legitimate weeks", () => {
  it("allows a taper to cut below recent behavior", () => {
    expect(checkCoachProperties(planFor({ trainingPhase: "taper", previousWeekKm: 45 }))).toEqual([]);
  });

  it("allows an explicit deload to cut below recent behavior", () => {
    expect(checkCoachProperties(planFor({ previousDecision: "DELOAD", previousWeekKm: 45 }))).toEqual([]);
  });

  it("skips the habit check when the athlete has no known pattern", () => {
    expect(
      checkCoachProperties(planFor({ runDays: [1, 3, 6], preferredRunDays: [] })).map((x) => x.property),
    ).not.toContain("days_match_the_athletes_week");
  });

  it("allows run/walk copy for a distance never yet run unbroken", () => {
    const base = planFor({});
    const returning: CoachPropertyInput = {
      ...base,
      longestRunKm30d: 2,
      keySession: { day: 6, title: "Longest easy run/walk", intensity: "low", plannedKm: 4 },
      sessions: [{ day: 6, title: "Longest easy run/walk", intensity: "low", plannedKm: 4 }],
    };
    expect(checkCoachProperties(returning).map((x) => x.property)).not.toContain(
      "copy_matches_demonstrated_capacity",
    );
  });
});
