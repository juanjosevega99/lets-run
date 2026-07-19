import type { Predictor } from "./types.js";
import { allPredictors } from "../deterministic/predictors.js";

/**
 * Predictors under evaluation. Multiple run side by side so model variants are
 * compared in one report — the backtest, not taste, picks what the dashboard uses.
 */
export const predictors: Predictor[] = allPredictors;
