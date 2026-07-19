import "dotenv/config";
import { connect } from "../db.js";
import { generateWeekPlan } from "./generate.js";
import { anthropicLlm } from "./llm.js";
import { toValidatorSessions } from "./schema.js";
import { buildPlanContext, nextMonday } from "./context.js";

/**
 * Generates next week's plan (F3) and persists it to plan_week:
 *
 *   npm run plan
 *
 * Deterministic inputs (limiter, fitness, paces, volume baseline) are assembled here;
 * the LLM only phrases the sessions; the S2 validator gates the result (retry loop in
 * generate.ts). Requires Anthropic credentials (ANTHROPIC_API_KEY or `ant auth login`).
 */
async function main() {
  const sql = connect();
  try {
    const ctx = await buildPlanContext(sql);
    console.log(`limiter: ${ctx.limiter.limiter} — ${ctx.limiter.reason}`);
    console.log(`generating plan (validator-gated, up to 3 attempts)...`);

    const { plan, attempts } = await generateWeekPlan(anthropicLlm(), ctx);

    const weekStart = nextMonday();
    await sql`
      insert into plan_week (week_start, target_limiter, key_session, support_sessions, explanation, model_version)
      values (${weekStart}, ${plan.target_limiter}, ${sql.json(plan.key_session as never)},
              ${sql.json(plan.support_sessions as never)}, ${plan.explanation}, 'plan-v1')
      on conflict (week_start) do update set
        target_limiter = excluded.target_limiter,
        key_session = excluded.key_session,
        support_sessions = excluded.support_sessions,
        explanation = excluded.explanation,
        model_version = excluded.model_version,
        generated_at = now()
    `;

    console.log(`\nplan for week of ${weekStart} (accepted on attempt ${attempts}):\n`);
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    for (const s of toValidatorSessions(plan).sort((a, b) => a.day - b.day)) {
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
  const msg = String(err?.message ?? err);
  if (msg.includes("authentication") || msg.includes("apiKey") || msg.includes("x-api-key")) {
    console.error(
      "\nNo Anthropic credentials found. Set ANTHROPIC_API_KEY in .env (create a key at" +
        " console.anthropic.com), or run `ant auth login`. Everything deterministic already" +
        " ran — only the plan-phrasing step needs the API.\n" +
        "No cost option: `npm run plan:free` generates a full week from the same limiter" +
        " and fitness data using fixed templates instead of an LLM call.",
    );
  } else {
    console.error(msg);
  }
  process.exit(1);
});
