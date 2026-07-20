import type { Sql } from "../db.js";
import { buildPlanContext, nextMonday, reviewCutoffForReplan } from "./context.js";
import { buildWeekTemplate, plannedRunVolumeCeiling } from "../deterministic/weekTemplate.js";
import { phaseRunDays } from "../deterministic/trainingPhase.js";
import { validateWeek, type PlannedSession } from "../deterministic/validator.js";
import type { Log } from "../strava/sync.js";
import { reviewLatestCompletedWeek } from "./review.js";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Zero-LLM week generation core: limiter + fitness → deterministic template → S2
 * validator → plan_week. Shared by `npm run plan:free` and the dashboard button.
 * Does NOT close `sql`.
 */
export async function generateFreeWeekPlan(sql: Sql, log: Log): Promise<void> {
  await reviewLatestCompletedWeek(sql, reviewCutoffForReplan(), log);
  const ctx = await buildPlanContext(sql);
  log(`phase: ${ctx.trainingPhase}`);
  log(`limiter: ${ctx.limiter.limiter} — ${ctx.limiter.reason}`);
  const maxPlannedRunKm = plannedRunVolumeCeiling(ctx);
  log(
    `controller: running ceiling ${maxPlannedRunKm.toFixed(1)}km · running balance ${ctx.tsb.toFixed(1)} · aerobic balance ${ctx.aerobicTsb?.toFixed(1) ?? "unknown"} · whole-program balance ${ctx.totalTsb?.toFixed(1) ?? "unknown"} (context only)`,
  );

  const plan = buildWeekTemplate({
    limiter: ctx.limiter.limiter,
    limiterReason: ctx.limiter.reason,
    trainingPhase: ctx.trainingPhase,
    previousWeekKm: ctx.previousWeekKm,
    tsb: ctx.tsb,
    aerobicTsb: ctx.aerobicTsb,
    totalAtl: ctx.totalAtl,
    totalTsb: ctx.totalTsb,
    previousDecision: ctx.previousDecision,
    runDays: phaseRunDays(ctx.trainingPhase, ctx.lowerBodyStrengthDays),
    strengthDays: ctx.strengthDays,
    lowerBodyStrengthDays: ctx.lowerBodyStrengthDays,
    longestRunKm30d: ctx.longestRunKm30d,
    easyPaceSecPerKm: ctx.paces?.easySecPerKm ?? null,
    thresholdPaceSecPerKm: ctx.paces?.thresholdSecPerKm ?? null,
    easyHrCeiling: ctx.easyHrCeiling,
  });

  const sessions: PlannedSession[] = [plan.key_session, ...plan.support_sessions].map((s) => ({
    day: s.day,
    title: s.title,
    intensity: s.intensity,
    plannedKm: s.planned_km,
    plannedMinutes: s.planned_minutes,
  }));

  const violations = validateWeek({
    sessions,
    previousWeekKm: ctx.previousWeekKm,
    trainingPhase: ctx.trainingPhase,
    maxPlannedRunKm,
    longestRunKm30d: ctx.longestRunKm30d,
    keySessionDay: plan.key_session.day,
    lowerBodyStrengthDays: ctx.lowerBodyStrengthDays,
    requiredStrengthDays: ctx.strengthDays,
  });
  if (violations.length > 0) {
    // A template violating its own rules is a bug in weekTemplate.ts, not something to
    // silently patch around — same "never trust unvalidated output" stance as the LLM
    // path, surfaced as a hard failure instead of a retry.
    throw new Error(
      `template produced an invalid week (this is a bug): ${violations.map((v) => `${v.rule} (${v.detail})`).join("; ")}`,
    );
  }

  const weekStart = nextMonday();
  await sql`
    insert into plan_week (week_start, target_limiter, key_session, support_sessions, explanation, model_version)
    values (${weekStart}, ${plan.target_limiter}, ${sql.json(plan.key_session as never)},
            ${sql.json(plan.support_sessions as never)}, ${plan.explanation}, 'coach-v2')
    on conflict (week_start) do update set
      target_limiter = excluded.target_limiter,
      key_session = excluded.key_session,
      support_sessions = excluded.support_sessions,
      explanation = excluded.explanation,
      model_version = excluded.model_version,
      generated_at = now()
  `;

  log(`plan for week of ${weekStart} (coach-v2, zero cost):`);
  for (const s of [...sessions].sort((a, b) => a.day - b.day)) {
    const key = s.title === plan.key_session.title ? "  ★ KEY" : "";
    const dose = s.plannedMinutes != null
      ? `${s.plannedMinutes}min (~${s.plannedKm.toFixed(1)}km)`
      : s.plannedKm > 0
        ? `${s.plannedKm.toFixed(1)}km`
        : "—";
    log(
      `  ${DAY_NAMES[s.day]}  ${s.intensity.padEnd(5)}  ${dose}  ${s.title}${key}`,
    );
  }
}
