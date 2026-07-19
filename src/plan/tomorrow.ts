import "dotenv/config";
import { connect } from "../db.js";
import { buildPlanContext } from "./context.js";
import { formatDuration } from "../lib/time.js";

/**
 * A single day's suggestion with ZERO LLM calls — for when ANTHROPIC_API_KEY isn't
 * set yet. Reuses the exact same deterministic context as the F3 week planner
 * (limiter, fitness, paces); the mapping from TSB → intensity below is a small,
 * explicit, transparent rule, not a fitted model — read it, don't trust it blindly.
 * Not persisted; not part of the F1 domain layer or the F3 pipeline.
 *
 *   npm run tomorrow
 */
async function main() {
  const sql = connect();
  try {
    const ctx = await buildPlanContext(sql);
    const tomorrow = new Date(Date.now() + 86_400_000);
    const dayName = new Intl.DateTimeFormat("en", { weekday: "long" }).format(tomorrow);

    console.log(`${ctx.raceName} — ${ctx.daysToRace} days to go`);
    console.log(`limiter: ${ctx.limiter.limiter} — ${ctx.limiter.reason}`);
    console.log(
      `fitness: CTL ${ctx.ctl.toFixed(1)} (running) · ATL ${ctx.atl.toFixed(1)} (fatigue, all sports) · TSB ${ctx.tsb.toFixed(1)} (form)`,
    );
    if (ctx.predictedTimeS != null) {
      console.log(`current prediction: ${formatDuration(ctx.predictedTimeS)} (target ${formatDuration(ctx.targetTimeS)})`);
    }
    console.log(`\n${dayName}:\n`);

    for (const line of suggest(ctx.tsb, ctx.limiter.limiter, ctx.paces)) {
      console.log(`  ${line}`);
    }

    console.log(`\nThis is a single-day rule of thumb, not the F3 weekly plan (that needs an LLM`);
    console.log(`call — run \`npm run plan\` once ANTHROPIC_API_KEY is set in .env).`);
  } finally {
    await sql.end();
  }
}

function suggest(
  tsb: number,
  limiter: string,
  paces: { easySecPerKm: number; thresholdSecPerKm: number } | null,
): string[] {
  const easy = paces ? paceStr(paces.easySecPerKm) : null;

  // TSB below -20 means real accumulated fatigue (here: two long rides this weekend) —
  // recovery outranks the limiter regardless of what it is.
  if (tsb < -20) {
    return [
      `TSB ${tsb.toFixed(1)} — real fatigue on board (this weekend's rides). Recover first.`,
      easy
        ? `Easy 20-30min jog at ${easy}/km if the legs feel okay, or full rest if they don't.`
        : `Full rest or a short easy walk/jog.`,
      `Don't chase volume today — a fatigued easy run teaches the body the wrong pace.`,
    ];
  }

  if (limiter === "aerobic_base") {
    return [
      `Limiter is aerobic base — CTL is still near zero, so the only job right now is`,
      `consistent easy running, not intensity.`,
      easy
        ? `Suggest: 20-30min continuous easy run at ${easy}/km, conversational effort.`
        : `Suggest: 20-30min continuous easy run at a fully conversational pace.`,
    ];
  }

  return [
    `Limiter is ${limiter} — this is past the "just run easy" stage; the right session`,
    `depends on the week's structure. Worth generating the real weekly plan for this one.`,
  ];
}

function paceStr(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
