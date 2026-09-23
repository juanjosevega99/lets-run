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

export type RefreshStep = { name: string; run: (sql: Sql, log: Log) => Promise<unknown> };

/** Everything: the Sunday-evening action that also rebuilds the week's prescription. */
export const FULL_REFRESH_STEPS: RefreshStep[] = [
  { name: "sync", run: syncStrava },
  { name: "fitness", run: rebuildFitness },
  { name: "current shape", run: generateLivePrediction },
  { name: "plan", run: generateFreeWeekPlan },
];

/**
 * Bring the record up to date WITHOUT rewriting the prescription.
 *
 * Used by the per-activity sync button and by the scheduled job. A mid-week sync must
 * not regenerate the plan: the athlete is part-way through a week, and silently
 * reshuffling the remaining sessions underneath him makes the plan untrustworthy — and
 * would let a background job change training nobody asked it to change. Planning stays
 * an explicit act.
 */
export const SYNC_ONLY_STEPS: RefreshStep[] = FULL_REFRESH_STEPS.filter((s) => s.name !== "plan");

export async function runRefresh(sql: Sql, steps: RefreshStep[] = FULL_REFRESH_STEPS): Promise<RefreshResult> {
  const log: string[] = [];
  const append: Log = (line) => log.push(line);

  for (const step of steps) {
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
