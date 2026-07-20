import "dotenv/config";
import { connect } from "../db.js";
import { buildPlanContext } from "./context.js";
import { formatDuration } from "../lib/time.js";
import { phaseRunDays } from "../deterministic/trainingPhase.js";

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
    const shortDay = new Intl.DateTimeFormat("en", {
      weekday: "short",
      timeZone: process.env.DASHBOARD_TZ ?? "America/Bogota",
    }).format(tomorrow);
    const isoWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(shortDay);

    console.log(`${ctx.raceName} — ${ctx.daysToRace} days to go`);
    console.log(`limiter: ${ctx.limiter.limiter} — ${ctx.limiter.reason}`);
    console.log(
      `load: running chronic ${ctx.ctl.toFixed(1)} · running acute ${ctx.atl.toFixed(1)} · running balance ${ctx.tsb.toFixed(1)} · whole-program balance ${ctx.totalTsb?.toFixed(1) ?? "unknown"}`,
    );
    if (ctx.predictedTimeS != null) {
      console.log(`current-shape estimate: ${formatDuration(ctx.predictedTimeS)} (target ${formatDuration(ctx.targetTimeS)})`);
    }
    console.log(`\n${dayName}:\n`);

    for (const line of suggest({
      phase: ctx.trainingPhase,
      limiter: ctx.limiter.limiter,
      runningTsb: ctx.tsb,
      totalTsb: ctx.totalTsb,
      paces: ctx.paces,
      easyHrCeiling: ctx.easyHrCeiling,
      day: isoWeekday,
      runDays: phaseRunDays(ctx.trainingPhase, ctx.lowerBodyStrengthDays),
      strengthDays: ctx.strengthDays,
    })) {
      console.log(`  ${line}`);
    }

    console.log(`\nThis is a single-day view. The canonical prescription is \`npm run plan:free\`.`);
  } finally {
    await sql.end();
  }
}

function suggest(x: {
  phase: string;
  limiter: string;
  runningTsb: number;
  totalTsb: number | null;
  paces: { easySecPerKm: number; thresholdSecPerKm: number | null } | null;
  easyHrCeiling: number | null;
  day: number;
  runDays: number[];
  strengthDays: number[];
}): string[] {
  const { paces, easyHrCeiling } = x;
  const easy = paces ? paceStr(paces.easySecPerKm) : null;
  // HR governs when available — a pace target alone can be far too fast while detrained.
  const effort = easyHrCeiling
    ? `HR under ${easyHrCeiling} bpm${easy ? ` (roughly ${easy}/km)` : ""}`
    : easy
      ? `${easy}/km, conversational`
      : "fully conversational effort";

  // TSB below -20 means real accumulated fatigue (here: two long rides this weekend) —
  // recovery outranks the limiter regardless of what it is.
  if ((x.totalTsb ?? x.runningTsb) < -25) {
    return [
      `Whole-program load is elevated. Keep the prescribed dose reduced and do not add training.`,
      x.runDays.includes(x.day)
        ? `If pain-free and legs feel normal: the planned easy run/walk at ${effort}; otherwise rest.`
        : x.strengthDays.includes(x.day)
          ? `Gym only as planned; reduce lower-body work if soreness is present.`
          : `Full rest.`,
    ];
  }

  if (x.phase === "return_to_run") {
    if (!x.runDays.includes(x.day)) {
      return [x.strengthDays.includes(x.day) ? "Gym only as planned; no extra run." : "Full rest; no extra run."];
    }
    return [`Return-to-run day: complete only the planned easy run/walk — ${effort}. Walk breaks are allowed.`];
  }

  if (x.limiter === "aerobic_base") {
    return [
      `Limiter is aerobic base — CTL is still near zero, so the only job right now is`,
      `consistent easy running, not intensity.`,
      `Suggest: 20-30min continuous easy run — ${effort}.`,
    ];
  }

  return [
    `Limiter is ${x.limiter} — this is past the "just run easy" stage; the right session`,
    `depends on the week's structure. Worth generating the real weekly plan for this one.`,
  ];
}

function paceStr(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${s === 60 ? m + 1 : m}:${String(s === 60 ? 0 : s).padStart(2, "0")}`;
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
