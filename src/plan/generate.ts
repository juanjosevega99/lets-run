import { validateWeek, type Violation } from "../deterministic/validator.js";
import type { LimiterResult } from "../deterministic/limiter.js";
import type { TrainingPhase } from "../deterministic/trainingPhase.js";
import { formatDuration } from "../lib/time.js";
import { toValidatorSessions, type GeneratedPlan } from "./schema.js";
import type { WeekDecision } from "./review.js";

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
  trainingPhase: TrainingPhase;
  ctl: number;
  atl: number;
  tsb: number;
  aerobicCtl: number | null;
  aerobicTsb: number | null;
  totalAtl: number | null;
  totalTsb: number | null;
  previousWeekKm: number | null;
  recentWeeklyKm: number[]; // last ~4 weeks, oldest first
  runs28d: number;
  activeRunWeeks4: number;
  daysSinceLastRun: number | null;
  longestRunKm30d: number;
  longestRunKm120d: number;
  qualityShare28d: number | null;
  strengthDays: number[];
  lowerBodyStrengthDays: number[];
  previousDecision: WeekDecision | null;
  paces: { easySecPerKm: number; thresholdSecPerKm: number | null } | null;
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
      trainingPhase: ctx.trainingPhase,
      longestRunKm30d: ctx.longestRunKm30d,
      keySessionDay: plan.key_session.day,
      lowerBodyStrengthDays: ctx.lowerBodyStrengthDays,
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
5. In return_to_run: exactly three nonconsecutive easy run/walk sessions, no quality
   work, and no single run more than 10% beyond the recent longest (4km if none).

Structure: exactly one key session (the limiter-targeting session — intensity may be "high"
or, for pure base/long weeks, "low"), plus support sessions. Days: 0=Monday .. 6=Sunday.
Cross-training/gym may appear as sessions with planned_km 0 and intensity "low". Preserve
the runner's listed gym days and never guess which are lower-body when not configured.
Whole-program balance is context only: never reduce running or gym from that number alone;
only running/aerobic load and explicit soreness, pain, or a prior DELOAD may constrain work.
The explanation is one short paragraph: why THIS week, tied to the limiter and the numbers.`;

export function buildUserPrompt(ctx: PlanContext, previousViolations: Violation[]): string {
  const lines: string[] = [];
  lines.push(`## Current state (deterministic, do not re-derive)`);
  lines.push(`- training phase: ${ctx.trainingPhase}`);
  lines.push(`- limiter to target: ${ctx.limiter.limiter} — ${ctx.limiter.reason}`);
  lines.push(`- running state: CTL ${ctx.ctl.toFixed(1)}, ATL ${ctx.atl.toFixed(1)}, TSB ${ctx.tsb.toFixed(1)}`);
  if (ctx.aerobicCtl != null || ctx.totalAtl != null) {
    lines.push(
      `- cross-training context: aerobic CTL ${ctx.aerobicCtl?.toFixed(1) ?? "unknown"}, aerobic load balance ${ctx.aerobicTsb?.toFixed(1) ?? "unknown"}, total acute load ${ctx.totalAtl?.toFixed(1) ?? "unknown"}, whole-program balance ${ctx.totalTsb?.toFixed(1) ?? "unknown"} (context only; generic gym duration is not a readiness signal)`,
    );
  }
  lines.push(
    `- continuity: ${ctx.runs28d} runs in 28d, ${ctx.activeRunWeeks4}/4 active weeks, ${ctx.daysSinceLastRun ?? "unknown"} days since last run`,
  );
  lines.push(
    `- longest run: ${ctx.longestRunKm30d.toFixed(1)}km in 30d (${ctx.longestRunKm120d.toFixed(1)}km in 120d)`,
  );
  lines.push(
    `- threshold time share, last 28d: ${ctx.qualityShare28d == null ? "unknown (insufficient measured HR)" : `${(ctx.qualityShare28d * 100).toFixed(1)}%`}`,
  );
  if (ctx.strengthDays.length > 0) {
    lines.push(
      `- usual strength days (0=Mon): ${ctx.strengthDays.join(", ")}; lower-body days: ${ctx.lowerBodyStrengthDays.join(", ") || "not configured"}`,
    );
  }
  if (ctx.previousDecision) lines.push(`- prior-week controller decision: ${ctx.previousDecision}`);
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
    lines.push(`- easy pace guide: ${paceStr(ctx.paces.easySecPerKm)}${provenance}`);
    lines.push(
      `- threshold pace: ${ctx.paces.thresholdSecPerKm == null ? "not prescribed — no fresh performance anchor; use controlled effort only" : paceStr(ctx.paces.thresholdSecPerKm)}`,
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
