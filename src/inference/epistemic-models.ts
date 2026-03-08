/**
 * Location: src/inference/epistemic-models.ts
 * Purpose: Model catalog for epistemic mode — Claude Haiku 4.5 via Anthropic API
 * Functions: EPISTEMIC_MODEL_BASELINE, EPISTEMIC_ROUTING_MATRIX
 * Calls: none
 * Imports: types from ../types.js
 */

import type { ModelEntry, RoutingMatrix } from "../types.js";

type ModelBaseline = Omit<ModelEntry, "lastSeen" | "createdAt" | "updatedAt">;

// costPer1kInput/Output in hundredths of a cent per 1k tokens
// e.g., $0.10/M = 10 cents/M = 0.01 cents/1k = 1 hundredth
function usdPerMTo100thCentPer1k(usdPerM: number): number {
  return Math.round(usdPerM * 100);  // $0.10/M → 10
}

/**
 * Claude Haiku 4.5 — single model for all epistemic agent operations.
 * Pricing: $0.80/M input, $4.00/M output
 * Context: 200K tokens
 * Supports: tools, vision
 */
export const EPISTEMIC_MODEL_BASELINE: ModelBaseline[] = [
  {
    modelId: "claude-haiku-4-5-20251001",
    provider: "anthropic",
    displayName: "Claude Haiku 4.5",
    tierMinimum: "low_compute",
    costPer1kInput: usdPerMTo100thCentPer1k(0.800),
    costPer1kOutput: usdPerMTo100thCentPer1k(4.000),
    maxTokens: 8192,
    contextWindow: 200000,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_tokens",
    enabled: true,
  },
];

/**
 * Epistemic routing matrix — all tiers use Claude Haiku 4.5.
 */
export const EPISTEMIC_ROUTING_MATRIX: RoutingMatrix = {
  high: {
    agent_turn: { candidates: ["claude-haiku-4-5-20251001"], maxTokens: 8192, ceilingCents: -1 },
    heartbeat_triage: { candidates: ["claude-haiku-4-5-20251001"], maxTokens: 2048, ceilingCents: 5 },
    safety_check: { candidates: ["claude-haiku-4-5-20251001"], maxTokens: 4096, ceilingCents: 20 },
    summarization: { candidates: ["claude-haiku-4-5-20251001"], maxTokens: 4096, ceilingCents: 15 },
    planning: { candidates: ["claude-haiku-4-5-20251001"], maxTokens: 8192, ceilingCents: -1 },
  },
  normal: {
    agent_turn: { candidates: ["claude-haiku-4-5-20251001"], maxTokens: 8192, ceilingCents: -1 },
    heartbeat_triage: { candidates: ["claude-haiku-4-5-20251001"], maxTokens: 2048, ceilingCents: 5 },
    safety_check: { candidates: ["claude-haiku-4-5-20251001"], maxTokens: 4096, ceilingCents: 15 },
    summarization: { candidates: ["claude-haiku-4-5-20251001"], maxTokens: 4096, ceilingCents: 10 },
    planning: { candidates: ["claude-haiku-4-5-20251001"], maxTokens: 8192, ceilingCents: -1 },
  },
  low_compute: {
    agent_turn: { candidates: ["claude-haiku-4-5-20251001"], maxTokens: 8192, ceilingCents: 30 },
    heartbeat_triage: { candidates: ["claude-haiku-4-5-20251001"], maxTokens: 2048, ceilingCents: 5 },
    safety_check: { candidates: ["claude-haiku-4-5-20251001"], maxTokens: 4096, ceilingCents: 10 },
    summarization: { candidates: ["claude-haiku-4-5-20251001"], maxTokens: 4096, ceilingCents: 10 },
    planning: { candidates: ["claude-haiku-4-5-20251001"], maxTokens: 8192, ceilingCents: 15 },
  },
  critical: {
    agent_turn: { candidates: ["claude-haiku-4-5-20251001"], maxTokens: 2048, ceilingCents: 5 },
    heartbeat_triage: { candidates: ["claude-haiku-4-5-20251001"], maxTokens: 512, ceilingCents: 2 },
    safety_check: { candidates: ["claude-haiku-4-5-20251001"], maxTokens: 1024, ceilingCents: 3 },
    summarization: { candidates: [], maxTokens: 0, ceilingCents: 0 },
    planning: { candidates: [], maxTokens: 0, ceilingCents: 0 },
  },
  dead: {
    agent_turn: { candidates: [], maxTokens: 0, ceilingCents: 0 },
    heartbeat_triage: { candidates: [], maxTokens: 0, ceilingCents: 0 },
    safety_check: { candidates: [], maxTokens: 0, ceilingCents: 0 },
    summarization: { candidates: [], maxTokens: 0, ceilingCents: 0 },
    planning: { candidates: [], maxTokens: 0, ceilingCents: 0 },
  },
};
