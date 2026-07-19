import { describe, expect, it } from "vitest";
import { generateWeekPlan, buildUserPrompt, MAX_ATTEMPTS, type PlanContext } from "./generate.js";
import type { GeneratedPlan } from "./schema.js";

const ctx: PlanContext = {
  limiter: { limiter: "aerobic_base", reason: "CTL 1% of peak" },
  ctl: 0.6,
  atl: 8,
  tsb: -8.7,
  previousWeekKm: 20,
  recentWeeklyKm: [0, 5, 12, 20],
  paces: { easySecPerKm: 360, thresholdSecPerKm: 252 },
  paceSource: "observed",
  easyHrCeiling: 159,
  daysToRace: 279,
  targetTimeS: 5834,
  raceName: "Patagonia 21K",
  predictedTimeS: 6517,
};

const legalPlan: GeneratedPlan = {
  target_limiter: "aerobic_base",
  key_session: { day: 6, title: "Long run", description: "easy long run", intensity: "low", planned_km: 8 },
  support_sessions: [
    { day: 0, title: "Easy run", description: "conversational", intensity: "low", planned_km: 5 },
    { day: 2, title: "Easy run", description: "conversational", intensity: "low", planned_km: 5 },
    { day: 4, title: "Gym", description: "strength", intensity: "low", planned_km: 0 },
  ],
  explanation: "Rebuild volume gently.",
};

// violates the 10% progression rule (20km last week → 30km planned) AND consecutive highs
const illegalPlan: GeneratedPlan = {
  target_limiter: "aerobic_base",
  key_session: { day: 1, title: "Intervals", description: "hard", intensity: "high", planned_km: 10 },
  support_sessions: [
    { day: 2, title: "Tempo", description: "hard again", intensity: "high", planned_km: 10 },
    { day: 3, title: "Easy", description: "easy", intensity: "low", planned_km: 10 },
  ],
  explanation: "Way too much.",
};

describe("generateWeekPlan (validator retry loop)", () => {
  it("accepts a legal plan on the first attempt", async () => {
    const { plan, attempts } = await generateWeekPlan(async () => legalPlan, ctx);
    expect(attempts).toBe(1);
    expect(plan.key_session.title).toBe("Long run");
  });

  it("rejects an illegal plan, feeds the violations back, and accepts the fix", async () => {
    const prompts: string[] = [];
    let call = 0;
    const llm = async (_system: string, user: string) => {
      prompts.push(user);
      call++;
      return call === 1 ? illegalPlan : legalPlan;
    };
    const { attempts } = await generateWeekPlan(llm, ctx);
    expect(attempts).toBe(2);
    expect(prompts[0]).not.toContain("REJECTED");
    expect(prompts[1]).toContain("REJECTED");
    expect(prompts[1]).toContain("volume_progression");
    expect(prompts[1]).toContain("consecutive_high");
  });

  it("gives up after MAX_ATTEMPTS with the violations in the error", async () => {
    await expect(generateWeekPlan(async () => illegalPlan, ctx)).rejects.toThrow(/volume_progression/);
    expect(MAX_ATTEMPTS).toBe(3);
  });

  it("prompt carries the deterministic inputs: limiter, rules baseline, paces, target", () => {
    const p = buildUserPrompt(ctx, []);
    expect(p).toContain("aerobic_base");
    expect(p).toContain("20.0 km (10% rule baseline)");
    expect(p).toContain("6:00/km"); // easy pace
    expect(p).toContain("1:37:14"); // target
    expect(p).toContain("279 days");
  });

  it("prompt states the HR ceiling and flags pace provenance so the LLM can't over-prescribe", () => {
    const observed = buildUserPrompt(ctx, []);
    expect(observed).toContain("easy HR ceiling: 159 bpm");
    expect(observed).toContain("HR governs");
    expect(observed).toContain("reflects CURRENT fitness");

    // when the pace came from a best-ever race, the prompt must warn it may be too fast
    const fromVdot = buildUserPrompt({ ...ctx, paceSource: "vdot" }, []);
    expect(fromVdot).toContain("may be too fast while detrained");
  });
});
