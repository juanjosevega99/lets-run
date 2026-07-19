import "dotenv/config";
import { connect, type Sql } from "../db.js";
import { predictors } from "../backtest/registry.js";
import { loadHistory, loadRaces } from "../backtest/history.js";
import { quantile } from "../backtest/metrics.js";
import { RACE, daysToRace } from "../lib/race.js";
import { formatDuration, isoDate } from "../lib/time.js";

/**
 * Live prediction for the target race, using everything known today.
 *
 *   npm run predict                        # default model + course gain estimate
 *   npm run predict -- --model vdot-v1 --gain 300
 *
 * Interval: empirical quantiles of the model's own backtest errors (PROJECT.md §11) —
 * plausible actual = predicted / (1 + err), so P90-error maps to the fast end.
 * Written to prediction_log (race_id null = live), which feeds the dashboard.
 */
const DEFAULT_MODEL = "vdot-ctl-v1"; // best backtest MAE as of 2026-07-19
const DEFAULT_COURSE_GAIN_M = 250; // estimate from the official altimetry (low rolling course)

async function main() {
  const args = process.argv.slice(2);
  const modelName = flagValue(args, "--model") ?? DEFAULT_MODEL;
  const gain = Number(flagValue(args, "--gain") ?? DEFAULT_COURSE_GAIN_M);

  const predictor = predictors.find((p) => p.name === modelName);
  if (!predictor) {
    console.error(`unknown model "${modelName}" — available: ${predictors.map((p) => p.name).join(", ")}`);
    process.exit(1);
  }

  const sql = connect();
  try {
    const races = await loadRaces(sql);
    const history = await loadHistory(sql, new Date(), races);
    const result = await predictor.predict(history, {
      distanceM: RACE.distanceM,
      terrain: "trail",
      elevationGainM: gain,
      raceDate: new Date(`${RACE.dateIso}T00:00:00Z`),
    });

    const errors = await backtestErrors(sql, predictor.name);
    let p10: number | null = null;
    let p90: number | null = null;
    if (errors.length >= 3) {
      const sorted = [...errors].sort((a, b) => a - b);
      // err = (pred − actual)/actual → actual = pred/(1 + err/100)
      p10 = result.timeS / (1 + quantile(sorted, 0.9) / 100); // fast end
      p90 = result.timeS / (1 + quantile(sorted, 0.1) / 100); // slow end
    }

    await sql`
      insert into prediction_log (data_cutoff, race_distance_m, predicted_time_s,
                                  interval_p10_s, interval_p90_s, predictor, context)
      values (${isoDate(new Date())}, ${RACE.distanceM}, ${result.timeS}, ${p10}, ${p90},
              ${predictor.name}, ${sql.json({ live: true, course_gain_m: gain, note: result.note ?? null })})
    `;

    const gapS = result.timeS - RACE.targetTimeS;
    console.log(`${RACE.name} — ${RACE.dateIso} (${daysToRace(new Date())} days)`);
    console.log(`model ${predictor.name} · course gain ${gain}m · ${result.note ?? ""}`);
    console.log(`\npredicted today: ${formatDuration(result.timeS)}`);
    if (p10 != null && p90 != null) {
      console.log(`plausible range: ${formatDuration(p10)} – ${formatDuration(p90)}  (from ${errors.length} backtest errors)`);
    } else {
      console.log("no interval — run `npm run backtest` first to build the error distribution");
    }
    console.log(
      gapS <= 0
        ? `already ${formatDuration(-gapS)} under the ${formatDuration(RACE.targetTimeS)} target`
        : `gap to target (${formatDuration(RACE.targetTimeS)}): ${formatDuration(gapS)}`,
    );
  } finally {
    await sql.end();
  }
}

/** Latest backtest error per race for this predictor (re-runs overwrite older logs). */
async function backtestErrors(sql: Sql, predictorName: string): Promise<number[]> {
  const rows = await sql<{ error_pct: string | null }[]>`
    select distinct on (race_id) context->>'error_pct' as error_pct
    from prediction_log
    where predictor = ${predictorName} and race_id is not null
    order by race_id, predicted_at desc
  `;
  return rows.map((r) => Number(r.error_pct)).filter((n) => Number.isFinite(n));
}

function flagValue(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1]! : null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
