import { formatDuration } from "../lib/time.js";
import { summarize } from "./metrics.js";

export interface RaceEvaluation {
  raceName: string;
  raceDate: string; // YYYY-MM-DD
  distanceKm: number;
  actualS: number;
  predictedS: number | null; // null = predictor failed on this race
  errorPct: number | null;
  note?: string;
  failure?: string;
}

export interface PredictorReport {
  predictor: string;
  evaluations: RaceEvaluation[];
}

/** Plain-text report: one table per predictor plus the S1 summary block. */
export function formatReport(reports: PredictorReport[]): string {
  if (reports.length === 0) {
    return [
      "backtest: no predictors registered.",
      "",
      "The harness is ready; the models are the hand-written part (PROJECT.md §9).",
      "Write your first one in src/deterministic/ (Riegel is the natural start) and",
      "register it in src/backtest/registry.ts — then re-run `npm run backtest`.",
    ].join("\n");
  }

  const lines: string[] = [];
  for (const r of reports) {
    lines.push(`predictor: ${r.predictor}`);
    lines.push("─".repeat(74));
    for (const e of r.evaluations) {
      const base = `  ${e.raceDate}  ${e.distanceKm.toFixed(1).padStart(5)}km  actual ${formatDuration(e.actualS).padStart(8)}`;
      if (e.predictedS === null) {
        lines.push(`${base}  FAILED: ${e.failure ?? "unknown"}`);
      } else {
        const err = e.errorPct!;
        const sign = err >= 0 ? "+" : "";
        lines.push(
          `${base}  predicted ${formatDuration(e.predictedS).padStart(8)}  ${sign}${err.toFixed(2)}%` +
            (e.note ? `  (${e.note})` : ""),
        );
      }
    }
    const errors = r.evaluations.filter((e) => e.errorPct !== null).map((e) => e.errorPct!);
    if (errors.length > 0) {
      const s = summarize(errors);
      lines.push("");
      lines.push(
        `  n=${s.n}  MAE ${s.maePct.toFixed(2)}%  bias ${s.biasPct >= 0 ? "+" : ""}${s.biasPct.toFixed(2)}%  ` +
          `err P10 ${s.p10.toFixed(2)}% / P50 ${s.p50.toFixed(2)}% / P90 ${s.p90.toFixed(2)}%`,
      );
      lines.push(`  S1 target: MAE < 3%  →  ${s.maePct < 3 ? "PASS" : "not yet"}`);
    } else {
      lines.push("  (no successful predictions)");
    }
    lines.push("");
  }
  return lines.join("\n");
}
