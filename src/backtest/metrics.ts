/**
 * Backtest error metrics. This is evaluation math (how wrong were the predictions),
 * not domain modeling — the models being measured live in src/deterministic/.
 */

/** Signed error in percent: positive = predicted slower than reality. */
export function signedErrorPct(predictedS: number, actualS: number): number {
  if (actualS <= 0) throw new Error(`actual time must be positive, got ${actualS}`);
  return ((predictedS - actualS) / actualS) * 100;
}

export interface ErrorSummary {
  n: number;
  /** Mean absolute error, percent — the S1 headline number (target < 3). */
  maePct: number;
  /** Signed mean, percent — reveals systematic optimism/pessimism. */
  biasPct: number;
  /** Empirical quantiles of the signed error — feeds the P10–P90 interval (PROJECT.md §11). */
  p10: number;
  p50: number;
  p90: number;
}

export function summarize(errorsPct: number[]): ErrorSummary {
  if (errorsPct.length === 0) throw new Error("cannot summarize zero errors");
  const sorted = [...errorsPct].sort((a, b) => a - b);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    n: errorsPct.length,
    maePct: mean(errorsPct.map(Math.abs)),
    biasPct: mean(errorsPct),
    p10: quantile(sorted, 0.1),
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
  };
}

/** Linear-interpolation quantile over an ascending-sorted array. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) throw new Error("quantile of empty array");
  if (q < 0 || q > 1) throw new Error(`q must be in [0,1], got ${q}`);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}
