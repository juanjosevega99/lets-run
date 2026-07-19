import "dotenv/config";
import { connect } from "../db.js";
import { generateFreeWeekPlan } from "./freePlan.js";

/**
 * Generates next week's plan with ZERO LLM calls — deterministic templates instead of
 * `npm run plan`'s Claude call. Same limiter, same fitness inputs, same S2 validator,
 * same plan_week table and /week dashboard rendering. No API key, no cost, ever.
 * The dashboard's refresh button runs the identical function.
 *
 *   npm run plan:free
 */
async function main() {
  const sql = connect();
  try {
    await generateFreeWeekPlan(sql, (line) => console.log(line));
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
