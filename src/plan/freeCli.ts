import "dotenv/config";
import { connect } from "../db.js";
import { buildPlanContext, nextMonday } from "./context.js";
import { buildWeekTemplate } from "../deterministic/weekTemplate.js";
import { validateWeek, type PlannedSession } from "../deterministic/validator.js";

/**
 * Generates next week's plan with ZERO LLM calls — deterministic templates
 * (src/deterministic/weekTemplate.ts) instead of `npm run plan`'s Claude call.
 * Same limiter, same fitness inputs, same S2 validator, same plan_week table and
 * /week dashboard rendering. No ANTHROPIC_API_KEY needed, no cost, ever.
 *
 *   npm run plan:free
 */
async function main() {
  const sql = connect();
  try {
    const ctx = await buildPlanContext(sql);
    console.log(`limiter: ${ctx.limiter.limiter} — ${ctx.limiter.reason}`);
    console.log(`building template (no API call)...`);

    const plan = buildWeekTemplate({
      limiter: ctx.limiter.limiter,
      limiterReason: ctx.limiter.reason,
      previousWeekKm: ctx.previousWeekKm,
      tsb: ctx.tsb,
      easyPaceSecPerKm: ctx.paces?.easySecPerKm ?? null,
      thresholdPaceSecPerKm: ctx.paces?.thresholdSecPerKm ?? null,
      easyHrCeiling: ctx.easyHrCeiling,
    });

    const sessions: PlannedSession[] = [plan.key_session, ...plan.support_sessions].map((s) => ({
      day: s.day,
      title: s.title,
      intensity: s.intensity,
      plannedKm: s.planned_km,
    }));
    const violations = validateWeek({ sessions, previousWeekKm: ctx.previousWeekKm });
    if (violations.length > 0) {
      // A template violating its own rules is a bug in weekTemplate.ts, not something
      // to silently patch around here — same "never trust unvalidated output" stance
      // as the LLM path, just surfaced as a hard failure instead of a retry.
      throw new Error(
        `template produced an invalid week (this is a bug): ${violations.map((v) => `${v.rule} (${v.detail})`).join("; ")}`,
      );
    }

    const weekStart = nextMonday();
    await sql`
      insert into plan_week (week_start, target_limiter, key_session, support_sessions, explanation, model_version)
      values (${weekStart}, ${plan.target_limiter}, ${sql.json(plan.key_session as never)},
              ${sql.json(plan.support_sessions as never)}, ${plan.explanation}, 'template-v1')
      on conflict (week_start) do update set
        target_limiter = excluded.target_limiter,
        key_session = excluded.key_session,
        support_sessions = excluded.support_sessions,
        explanation = excluded.explanation,
        model_version = excluded.model_version,
        generated_at = now()
    `;

    console.log(`\nplan for week of ${weekStart} (template-v1, zero cost):\n`);
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    for (const s of sessions.sort((a, b) => a.day - b.day)) {
      const key = s.title === plan.key_session.title ? "  ★ KEY" : "";
      console.log(
        `  ${days[s.day]}  ${s.intensity.padEnd(5)}  ${s.plannedKm > 0 ? `${s.plannedKm.toFixed(1)}km` : "—"}  ${s.title}${key}`,
      );
    }
    console.log(`\nwhy: ${plan.explanation}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
