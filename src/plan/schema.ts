import type { PlannedSession } from "../deterministic/validator.js";

/**
 * The plan's typed structured output (PRD F-A / PROJECT.md F3). The LLM must return
 * exactly this shape — enforced by the API's structured outputs (json_schema), then
 * re-validated semantically by the hard-rule validator. Belt and suspenders: the
 * prompt is not trusted (PROJECT.md S2).
 */
export interface GeneratedPlan {
  target_limiter: string;
  key_session: PlanSession;
  support_sessions: PlanSession[];
  explanation: string;
}

export interface PlanSession {
  day: number; // 0 = Monday … 6 = Sunday
  title: string;
  description: string;
  intensity: "low" | "high" | "rest";
  planned_km: number;
  planned_minutes?: number;
}

const SESSION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["day", "title", "description", "intensity", "planned_km"],
  properties: {
    day: { type: "integer", enum: [0, 1, 2, 3, 4, 5, 6] },
    title: { type: "string" },
    description: { type: "string" },
    intensity: { type: "string", enum: ["low", "high", "rest"] },
    planned_km: { type: "number", minimum: 0 },
    planned_minutes: { type: "number", minimum: 0 },
  },
} as const;

export const PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["target_limiter", "key_session", "support_sessions", "explanation"],
  properties: {
    target_limiter: { type: "string" },
    key_session: SESSION_SCHEMA,
    support_sessions: { type: "array", items: SESSION_SCHEMA },
    explanation: { type: "string" },
  },
} as const;

/** All sessions of the plan in the shape the S2 validator consumes. */
export function toValidatorSessions(plan: GeneratedPlan): PlannedSession[] {
  return [plan.key_session, ...plan.support_sessions].map((s) => ({
    day: s.day,
    title: s.title,
    intensity: s.intensity,
    plannedKm: s.planned_km,
    plannedMinutes: s.planned_minutes,
  }));
}
