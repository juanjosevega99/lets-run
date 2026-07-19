import type { Streams } from "../ingest/types.js";

/**
 * The backtest harness's consumption contract — the socket your hand-written
 * deterministic models (src/deterministic/, AI-free zone) plug into.
 *
 * IMPORTANT: this file describes what the HARNESS provides and expects, not how your
 * models should be designed. If your F1 design wants a different shape, reshape this
 * contract to fit the models — not the other way around.
 */

/** One activity as the predictor sees it. Summaries are pre-loaded; streams are lazy. */
export interface ActivitySummary {
  id: number;
  name: string;
  sportType: string;
  startDate: Date;
  distanceM: number | null;
  movingTimeS: number | null;
  elapsedTimeS: number | null;
  elevationGainM: number | null;
  avgHr: number | null;
  maxHr: number | null;
}

/** A past race with a trusted time — the natural reference performance for Riegel/VDOT. */
export interface RaceSummary {
  id: number;
  name: string;
  raceDate: Date;
  distanceM: number;
  officialTimeS: number;
  terrain: "road" | "trail" | "track";
  elevationGainM: number | null;
}

/**
 * Everything known BEFORE the cutoff date. The harness guarantees no activity or race
 * at/after the cutoff leaks in — that guarantee is what makes backtesting honest (S1).
 */
export interface TrainingHistory {
  cutoff: Date;
  activities: ActivitySummary[]; // sorted by startDate ascending
  priorRaces: RaceSummary[]; // races strictly before the cutoff
  /** Lazy per-activity streams (time/distance/altitude/HR) — for GAP etc. */
  getStreams(activityId: number): Promise<Streams | null>;
}

export interface PredictionRequest {
  distanceM: number;
  terrain: "road" | "trail" | "track";
  elevationGainM: number | null;
  raceDate: Date;
}

export interface PredictionResult {
  timeS: number;
  /** Optional short note about how the prediction was formed (shown in the report). */
  note?: string;
}

export interface Predictor {
  /** Stable name, e.g. "riegel-v1". Written to prediction_log.predictor. */
  name: string;
  predict(history: TrainingHistory, request: PredictionRequest): Promise<PredictionResult>;
}
