import { validateWeek, type Violation } from "../deterministic/validator.js";
import type { LimiterResult } from "../deterministic/limiter.js";
import { formatDuration } from "../lib/time.js";
import { toValidatorSessions, type GeneratedPlan } from "./schema.js";

/**
 * F3 plan generation: deterministic layer decides the WHAT (limiter, paces, volume
 * ceiling, hard rules); the LLM phrases the HOW (concrete sessions + the why). The
 * validator is the authority — an invalid plan is rejected and regenerated with the
 * violations fed back, up to MAX_ATTEMPTS (PROJECT.md S2: the prompt is not trusted).
 *
 * The LLM call is injected so this loop is unit-testable without an API key.
 */
export const MAX_ATTEMPTS = 3;

export interface PlanContext {
  limiter: LimiterResult;
  ctl: number;
  atl: number;
  tsb: number;
  previousWeekKm: number | null;
  recentWeeklyKm: number[]; // last ~4 weeks, oldest first
  paces: { easySecPerKm: number; thresholdSecPerKm: number } | null;
  /**
   * Where the easy pace came from. "observed" = median pace of recent runs actually
   * run in the easy HR band (reflects CURRENT fitness). "vdot" = derived from the
   * best-ever race (reflects PEAK fitness — too fast for a detrained athlete; only
   * used when there's no recent HR-tagged running to observe).
   */
  paceSource: "observed" | "vdot" | null;
  /** Do-not-exceed HR for easy running (79% HRmax). Null when no HR data exists. */
  easyHrCeiling: number | null;
  daysToRace: number;
  targetTimeS: number;
  raceName: string;
  predictedTimeS: number | null;
}

export type LlmCall = (system: string, user: string) => Promise<GeneratedPlan>;

export interface PlanGenerationResult {
  plan: GeneratedPlan;
  attempts: number;
}

export async function generateWeekPlan(llm: LlmCall, ctx: PlanContext): Promise<PlanGenerationResult> {
  let violations: Violation[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const plan = await llm(SYSTEM_PROMPT, buildUserPrompt(ctx, violations));
    violations = validateWeek({
      sessions: toValidatorSessions(plan),
      previousWeekKm: ctx.previousWeekKm,
    });
    if (violations.length === 0) {
      return { plan, attempts: attempt };
    }
  }
  throw new Error(
    `plan rejected after ${MAX_ATTEMPTS} attempts; last violations: ${violations
      .map((v) => `${v.rule} (${v.detail})`)
      .join("; ")}`,
  );
}

const SYSTEM_PROMPT = `You are the coaching voice of a deterministic training system for one
runner. The system has already decided WHAT this week must target (the limiter) and the hard
rules the week must obey — your job is to design the concrete sessions and explain the why in
plain, motivating language. You never change the target or bend a rule. The runner is an
experienced (returning) runner training for a trail half marathon.

HARD RULES the week MUST satisfy (a validator rejects violations):
1. Total planned km may exceed last week's actual km by AT MOST 10%.
2. At least one day (0-6) with NO session at all — a full rest day.
3. At least 75% of total planned km at "low" intensity.
4. No two "high" intensity sessions on consecutive days.

Structure: exactly one key session (the limiter-targeting session — intensity may be "high"
or, for pure base/long weeks, "low"), plus support sessions. Days: 0=Monday .. 6=Sunday.
Cross-training/gym may appear as sessions with planned_km 0 and intensity "low".
The explanation is one short paragraph: why THIS week, tied to the limiter and the numbers.`;

export function buildUserPrompt(ctx: PlanContext, previousViolations: Violation[]): string {
  const lines: string[] = [];
  lines.push(`## Current state (deterministic, do not re-derive)`);
  lines.push(`- limiter to target: ${ctx.limiter.limiter} — ${ctx.limiter.reason}`);
  lines.push(`- fitness: CTL ${ctx.ctl.toFixed(1)}, ATL ${ctx.atl.toFixed(1)}, TSB ${ctx.tsb.toFixed(1)}`);
  lines.push(
    `- recent weekly running km (oldest→newest): ${ctx.recentWeeklyKm.map((k) => k.toFixed(1)).join(", ") || "none"}`,
  );
  lines.push(
    `- last week's actual volume: ${ctx.previousWeekKm != null ? `${ctx.previousWeekKm.toFixed(1)} km (10% rule baseline)` : "none — no progression cap this week, still be conservative"}`,
  );
  if (ctx.paces) {
    const provenance =
      ctx.paceSource === "observed"
        ? " (measured from recent runs in the easy HR band — reflects CURRENT fitness)"
        : " (derived from best-ever race — may be too fast while detrained; prefer the HR ceiling)";
    lines.push(
      `- training paces: easy ${paceStr(ctx.paces.easySecPerKm)}, threshold ${paceStr(ctx.paces.thresholdSecPerKm)}${provenance}`,
    );
  }
  if (ctx.easyHrCeiling != null) {
    lines.push(
      `- easy HR ceiling: ${ctx.easyHrCeiling} bpm — easy sessions must stay under this. HR governs, pace is a guide.`,
    );
  }
  lines.push(`- race: ${ctx.raceName} in ${ctx.daysToRace} days · target ${formatDuration(ctx.targetTimeS)}`);
  if (ctx.predictedTimeS != null) {
    lines.push(`- current prediction: ${formatDuration(ctx.predictedTimeS)}`);
  }
  if (previousViolations.length > 0) {
    lines.push("");
    lines.push(`## YOUR PREVIOUS PLAN WAS REJECTED — fix exactly these violations:`);
    for (const v of previousViolations) lines.push(`- ${v.rule}: ${v.detail}`);
  }
  lines.push("");
  lines.push(`Design next week's plan.`);
  return lines.join("\n");
}

function paceStr(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
}
