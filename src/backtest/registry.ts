import type { Predictor } from "./types.js";

/**
 * Register hand-written predictors from src/deterministic/ here.
 *
 * This list is deliberately empty until F1 exists — the harness will tell you so
 * when you run `npm run backtest`. Example, once you've written one:
 *
 *   import { riegelPredictor } from "../deterministic/riegel.js";
 *   export const predictors: Predictor[] = [riegelPredictor];
 *
 * Multiple predictors run side by side, so model variants can be compared in one report.
 */
export const predictors: Predictor[] = [];
