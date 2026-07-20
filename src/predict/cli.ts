import "dotenv/config";
import { connect } from "../db.js";
import { DEFAULT_COURSE_GAIN_M, DEFAULT_LIVE_MODEL, generateLivePrediction } from "./live.js";

/**
 * Current-shape estimate for the target course, using everything known today.
 *
 *   npm run predict                        # default model + course gain estimate
 *   npm run predict -- --model vdot-v1 --gain 300
 *
 * Interval: empirical quantiles of the model's own backtest errors (PROJECT.md §11) —
 * plausible actual = predicted / (1 + err), so P90-error maps to the fast end.
 * Written to prediction_log (race_id null = live), which feeds the dashboard.
 */
async function main() {
  const args = process.argv.slice(2);
  const modelName = flagValue(args, "--model") ?? DEFAULT_LIVE_MODEL;
  const gain = Number(flagValue(args, "--gain") ?? DEFAULT_COURSE_GAIN_M);

  const sql = connect();
  try {
    await generateLivePrediction(sql, (line) => console.log(line), { modelName, courseGainM: gain });
  } finally {
    await sql.end();
  }
}

function flagValue(args: string[], flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1]! : null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
