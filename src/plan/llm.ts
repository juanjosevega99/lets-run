import Anthropic from "@anthropic-ai/sdk";
import { PLAN_JSON_SCHEMA, type GeneratedPlan } from "./schema.js";
import type { LlmCall } from "./generate.js";

/**
 * The real LLM call: Claude with structured outputs constrained to the plan schema.
 * Credentials resolve from the environment (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN,
 * or an `ant auth login` profile) — the zero-arg constructor handles all three.
 */
const MODEL = "claude-opus-4-8";

export function anthropicLlm(): LlmCall {
  const client = new Anthropic();
  return async (system: string, user: string): Promise<GeneratedPlan> => {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema: PLAN_JSON_SCHEMA } },
    });

    if (response.stop_reason === "refusal") {
      throw new Error("model refused the request");
    }
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      throw new Error(`no text block in response (stop_reason: ${response.stop_reason})`);
    }
    // structured outputs guarantee schema conformance; parse is still the honest boundary
    return JSON.parse(text.text) as GeneratedPlan;
  };
}
