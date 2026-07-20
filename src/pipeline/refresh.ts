import type { Sql } from "../db.js";
import { syncStrava, type Log } from "../strava/sync.js";
import { rebuildFitness } from "../fitness/rebuild.js";
import { generateFreeWeekPlan } from "../plan/freePlan.js";
import { generateLivePrediction } from "../predict/live.js";

/**
 * The Sunday-evening action, as one call: pull new training from Strava → recompute
 * fitness → update current shape → regenerate next week's plan.
 *
 * Steps are sequential and dependent — fitness needs the new activities, the plan
 * needs the new fitness. A failing step aborts the rest rather than planning off
 * stale numbers, but whatever already succeeded is kept (each step commits its own
 * writes), so a Strava outage still leaves the DB consistent.
 */
export interface RefreshResult {
  ok: boolean;
  log: string[];
  failedStep?: string;
  error?: string;
}

const STEPS: { name: string; run: (sql: Sql, log: Log) => Promise<unknown> }[] = [
  { name: "sync", run: syncStrava },
  { name: "fitness", run: rebuildFitness },
  { name: "current shape", run: generateLivePrediction },
  { name: "plan", run: generateFreeWeekPlan },
];

export async function runRefresh(sql: Sql): Promise<RefreshResult> {
  const log: string[] = [];
  const append: Log = (line) => log.push(line);

  for (const step of STEPS) {
    append(`── ${step.name} ──`);
    try {
      await step.run(sql, append);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      append(`FAILED: ${message}`);
      return { ok: false, log, failedStep: step.name, error: message };
    }
  }
  return { ok: true, log };
}
