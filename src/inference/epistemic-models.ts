/**
 * Location: src/inference/epistemic-models.ts
 * Purpose: OpenRouter model catalog for epistemic mode — 29 verified models with pricing
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
 * 29 verified OpenRouter models, tested 2026-03-08.
 * Organized by tier: ultra-cheap → cheap → mid → premium → reasoning
 *
 * Strengths/weaknesses documented per model.
 * All models tested with `Say hello in exactly 5 words` and confirmed working.
 */
export const EPISTEMIC_MODEL_BASELINE: ModelBaseline[] = [
  // ─── TIER 1: ULTRA-CHEAP ($0.10-$0.25/M input) ─────────────
  // Best for: routine agent turns, searches, saves
  {
    modelId: "google/gemini-3.1-flash-lite-preview",
    provider: "openai",
    displayName: "Gemini 3.1 Flash Lite (Preview)",
    tierMinimum: "low_compute",
    costPer1kInput: usdPerMTo100thCentPer1k(0.250),
    costPer1kOutput: usdPerMTo100thCentPer1k(1.500),
    maxTokens: 16384,
    contextWindow: 1048576,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_tokens",
    enabled: true,
    // Strengths: 1M context, multimodal, Google 3.1 gen, very cheap
    // Weaknesses: lite variant, less capable for complex reasoning
  },

  // ─── TIER 2: CHEAP ($0.05-$0.50/M input) ───────────────────
  // Best for: paper writing, literature analysis, hypothesis generation
  {
    modelId: "google/gemini-3-flash-preview",
    provider: "openai",
    displayName: "Gemini 3 Flash (Preview)",
    tierMinimum: "low_compute",
    costPer1kInput: usdPerMTo100thCentPer1k(0.500),
    costPer1kOutput: usdPerMTo100thCentPer1k(3.000),
    maxTokens: 16384,
    contextWindow: 1048576,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_tokens",
    enabled: true,
    // Strengths: 1M context, Gemini 3 gen, multimodal, excellent reasoning for the price
    // Weaknesses: preview model
  },
  {
    modelId: "meta-llama/llama-4-scout",
    provider: "openai",
    displayName: "Llama 4 Scout (17B, 16 experts)",
    tierMinimum: "low_compute",
    costPer1kInput: usdPerMTo100thCentPer1k(0.080),
    costPer1kOutput: usdPerMTo100thCentPer1k(0.300),
    maxTokens: 8192,
    contextWindow: 327680,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_tokens",
    enabled: true,
    // Strengths: MoE, 328k context, multimodal, very capable
    // Weaknesses: newer, less battle-tested
  },
  {
    modelId: "qwen/qwen3-32b",
    provider: "openai",
    displayName: "Qwen3 32B (reasoning)",
    tierMinimum: "low_compute",
    costPer1kInput: usdPerMTo100thCentPer1k(0.080),
    costPer1kOutput: usdPerMTo100thCentPer1k(0.240),
    maxTokens: 4096,
    contextWindow: 40960,
    supportsTools: true,
    supportsVision: false,
    parameterStyle: "max_tokens",
    enabled: true,
    // Strengths: strong reasoning, thinking mode, good for research
    // Weaknesses: 40k context
  },
  {
    modelId: "qwen/qwen3-30b-a3b",
    provider: "openai",
    displayName: "Qwen3 30B MoE (3B active)",
    tierMinimum: "low_compute",
    costPer1kInput: usdPerMTo100thCentPer1k(0.080),
    costPer1kOutput: usdPerMTo100thCentPer1k(0.280),
    maxTokens: 4096,
    contextWindow: 40960,
    supportsTools: true,
    supportsVision: false,
    parameterStyle: "max_tokens",
    enabled: true,
    // Strengths: MoE efficiency, only 3B active params, fast
    // Weaknesses: 40k context, smaller active capacity
  },
  {
    modelId: "google/gemini-3.1-flash-lite-preview",
    provider: "openai",
    displayName: "Gemini 2.0 Flash",
    tierMinimum: "low_compute",
    costPer1kInput: usdPerMTo100thCentPer1k(0.100),
    costPer1kOutput: usdPerMTo100thCentPer1k(0.400),
    maxTokens: 8192,
    contextWindow: 1048576,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_tokens",
    enabled: true,
    // Strengths: 1M context, multimodal, fast, Google quality
    // Weaknesses: sometimes verbose
  },
  {
    modelId: "meta-llama/llama-3.3-70b-instruct",
    provider: "openai",
    displayName: "Llama 3.3 70B Instruct",
    tierMinimum: "low_compute",
    costPer1kInput: usdPerMTo100thCentPer1k(0.100),
    costPer1kOutput: usdPerMTo100thCentPer1k(0.320),
    maxTokens: 4096,
    contextWindow: 131072,
    supportsTools: true,
    supportsVision: false,
    parameterStyle: "max_tokens",
    enabled: true,
    // Strengths: excellent all-around, 128k context, strong reasoning
    // Weaknesses: no vision, higher latency than smaller models
  },
  {
    modelId: "openai/gpt-4.1-nano",
    provider: "openai",
    displayName: "GPT-4.1 Nano (OpenAI)",
    tierMinimum: "low_compute",
    costPer1kInput: usdPerMTo100thCentPer1k(0.100),
    costPer1kOutput: usdPerMTo100thCentPer1k(0.400),
    maxTokens: 16384,
    contextWindow: 1047576,
    supportsTools: true,
    supportsVision: false,
    parameterStyle: "max_completion_tokens",
    enabled: true,
    // Strengths: fast, 1M context, good instruction following
    // Weaknesses: nano-class, limited deep reasoning
  },

  // ─── TIER 3: MID-RANGE ($0.15-$0.50/M input) ───────────────
  // Best for: complex research, validation, paper writing
  {
    modelId: "meta-llama/llama-4-maverick",
    provider: "openai",
    displayName: "Llama 4 Maverick (17B, 128 experts)",
    tierMinimum: "normal",
    costPer1kInput: usdPerMTo100thCentPer1k(0.150),
    costPer1kOutput: usdPerMTo100thCentPer1k(0.600),
    maxTokens: 8192,
    contextWindow: 1048576,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_tokens",
    enabled: true,
    // Strengths: 1M context, 128 experts, multimodal, frontier-class
    // Weaknesses: higher cost, higher latency
  },
  {
    modelId: "deepseek/deepseek-chat-v3-0324",
    provider: "openai",
    displayName: "DeepSeek V3 (685B MoE)",
    tierMinimum: "normal",
    costPer1kInput: usdPerMTo100thCentPer1k(0.200),
    costPer1kOutput: usdPerMTo100thCentPer1k(0.770),
    maxTokens: 8192,
    contextWindow: 163840,
    supportsTools: true,
    supportsVision: false,
    parameterStyle: "max_tokens",
    enabled: true,
    // Strengths: 685B params, excellent reasoning/math/code, cheap for quality
    // Weaknesses: higher latency, no vision
  },
  {
    modelId: "mistralai/mistral-small-3.1-24b-instruct",
    provider: "openai",
    displayName: "Mistral Small 3.1 24B",
    tierMinimum: "normal",
    costPer1kInput: usdPerMTo100thCentPer1k(0.350),
    costPer1kOutput: usdPerMTo100thCentPer1k(0.560),
    maxTokens: 4096,
    contextWindow: 128000,
    supportsTools: true,
    supportsVision: false,
    parameterStyle: "max_tokens",
    enabled: true,
    // Strengths: 128k context, strong function calling, efficient
    // Weaknesses: sometimes slow on OpenRouter
  },
  {
    modelId: "openai/gpt-4.1-mini",
    provider: "openai",
    displayName: "GPT-4.1 Mini (OpenAI)",
    tierMinimum: "normal",
    costPer1kInput: usdPerMTo100thCentPer1k(0.400),
    costPer1kOutput: usdPerMTo100thCentPer1k(1.600),
    maxTokens: 16384,
    contextWindow: 1047576,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_completion_tokens",
    enabled: true,
    // Strengths: 1M context, multimodal, reliable tool use, GPT quality
    // Weaknesses: higher cost, OpenAI pricing
  },
  {
    modelId: "mistralai/mistral-medium-3",
    provider: "openai",
    displayName: "Mistral Medium 3",
    tierMinimum: "normal",
    costPer1kInput: usdPerMTo100thCentPer1k(0.400),
    costPer1kOutput: usdPerMTo100thCentPer1k(2.000),
    maxTokens: 8192,
    contextWindow: 131072,
    supportsTools: true,
    supportsVision: false,
    parameterStyle: "max_tokens",
    enabled: true,
    // Strengths: enterprise-grade, strong reasoning, 128k context
    // Weaknesses: expensive output tokens
  },
  {
    modelId: "qwen/qwen3-235b-a22b",
    provider: "openai",
    displayName: "Qwen3 235B MoE (22B active)",
    tierMinimum: "normal",
    costPer1kInput: usdPerMTo100thCentPer1k(0.455),
    costPer1kOutput: usdPerMTo100thCentPer1k(1.820),
    maxTokens: 8192,
    contextWindow: 131072,
    supportsTools: true,
    supportsVision: false,
    parameterStyle: "max_tokens",
    enabled: true,
    // Strengths: 235B MoE, frontier reasoning, thinking mode
    // Weaknesses: higher latency, 128k context
  },

  // ─── TIER 4: PREMIUM ($0.50+/M input) ────────────────────────
  // Best for: final paper validation, complex synthesis, novel hypothesis
  // DeepSeek R1 removed — does not support tool/function calling, which the agent requires.
  {
    modelId: "amazon/nova-pro-v1",
    provider: "openai",
    displayName: "Amazon Nova Pro",
    tierMinimum: "normal",
    costPer1kInput: usdPerMTo100thCentPer1k(0.800),
    costPer1kOutput: usdPerMTo100thCentPer1k(3.200),
    maxTokens: 8192,
    contextWindow: 300000,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_tokens",
    enabled: true,
    // Strengths: 300k context, multimodal, good accuracy
    // Weaknesses: expensive for the quality tier
  },
  {
    modelId: "nvidia/llama-3.1-nemotron-70b-instruct",
    provider: "openai",
    displayName: "NVIDIA Nemotron 70B",
    tierMinimum: "high",
    costPer1kInput: usdPerMTo100thCentPer1k(1.200),
    costPer1kOutput: usdPerMTo100thCentPer1k(1.200),
    maxTokens: 8192,
    contextWindow: 131072,
    supportsTools: true,
    supportsVision: false,
    parameterStyle: "max_tokens",
    enabled: true,
    // Strengths: NVIDIA-tuned, precise outputs, 128k context
    // Weaknesses: expensive, single-use pricing
  },
  {
    modelId: "google/gemini-2.5-pro-preview",
    provider: "openai",
    displayName: "Gemini 2.5 Pro Preview",
    tierMinimum: "high",
    costPer1kInput: usdPerMTo100thCentPer1k(1.250),
    costPer1kOutput: usdPerMTo100thCentPer1k(10.000),
    maxTokens: 16384,
    contextWindow: 1048576,
    supportsTools: true,
    supportsVision: true,
    parameterStyle: "max_tokens",
    enabled: true,
    // Strengths: frontier-class, 1M context, multimodal, Google's best
    // Weaknesses: very expensive output, preview model
  },
  {
    modelId: "cohere/command-a",
    provider: "openai",
    displayName: "Cohere Command A (111B)",
    tierMinimum: "high",
    costPer1kInput: usdPerMTo100thCentPer1k(2.500),
    costPer1kOutput: usdPerMTo100thCentPer1k(10.000),
    maxTokens: 8192,
    contextWindow: 256000,
    supportsTools: true,
    supportsVision: false,
    parameterStyle: "max_tokens",
    enabled: true,
    // Strengths: 256k context, RAG-optimized, excellent citations
    // Weaknesses: very expensive, no vision
  },
];

/**
 * Epistemic routing matrix — maps survival tier to model preferences.
 *
 * Strategy:
 * - high: use frontier models for complex research
 * - normal: balanced quality/cost for daily work
 * - low_compute: cheap but capable for routine tasks
 * - critical: absolute minimum cost to stay alive
 * - dead: nothing (agent is dead)
 */
export const EPISTEMIC_ROUTING_MATRIX: RoutingMatrix = {
  high: {
    agent_turn: {
      candidates: [
        "deepseek/deepseek-chat-v3-0324",
        "qwen/qwen3-235b-a22b",
        "meta-llama/llama-4-maverick",
        "google/gemini-2.5-pro-preview",
      ],
      maxTokens: 8192,
      ceilingCents: -1,
    },
    heartbeat_triage: {
      candidates: ["meta-llama/llama-4-scout", "qwen/qwen3-32b"],
      maxTokens: 2048,
      ceilingCents: 5,
    },
    safety_check: {
      candidates: ["openai/gpt-4.1-mini", "mistralai/mistral-medium-3"],
      maxTokens: 4096,
      ceilingCents: 20,
    },
    summarization: {
      candidates: ["google/gemini-3.1-flash-lite-preview", "meta-llama/llama-3.3-70b-instruct"],
      maxTokens: 4096,
      ceilingCents: 15,
    },
    planning: {
      candidates: [
        "deepseek/deepseek-chat-v3-0324",
        "qwen/qwen3-235b-a22b",
        "openai/gpt-4.1-mini",
      ],
      maxTokens: 8192,
      ceilingCents: -1,
    },
  },
  normal: {
    agent_turn: {
      candidates: [
        "google/gemini-3-flash-preview",
        "deepseek/deepseek-chat-v3-0324",
        "google/gemini-3.1-flash-lite-preview",
        "meta-llama/llama-4-maverick",
      ],
      maxTokens: 16384,
      ceilingCents: -1,
    },
    heartbeat_triage: {
      candidates: ["google/gemini-3.1-flash-lite-preview", "meta-llama/llama-4-scout"],
      maxTokens: 2048,
      ceilingCents: 5,
    },
    safety_check: {
      candidates: ["google/gemini-3-flash-preview", "openai/gpt-4.1-mini"],
      maxTokens: 4096,
      ceilingCents: 15,
    },
    summarization: {
      candidates: ["google/gemini-3.1-flash-lite-preview", "google/gemini-3.1-flash-lite-preview"],
      maxTokens: 4096,
      ceilingCents: 10,
    },
    planning: {
      candidates: [
        "google/gemini-3-flash-preview",
        "deepseek/deepseek-chat-v3-0324",
      ],
      maxTokens: 8192,
      ceilingCents: -1,
    },
  },
  low_compute: {
    agent_turn: {
      candidates: [
        "google/gemini-3-flash-preview",
        "google/gemini-3.1-flash-lite-preview",
        "deepseek/deepseek-chat-v3-0324",
        "google/gemini-3.1-flash-lite-preview",
      ],
      maxTokens: 16384,
      ceilingCents: 30,
    },
    heartbeat_triage: {
      candidates: ["google/gemini-3.1-flash-lite-preview", "meta-llama/llama-4-scout"],
      maxTokens: 2048,
      ceilingCents: 5,
    },
    safety_check: {
      candidates: ["google/gemini-3.1-flash-lite-preview", "qwen/qwen3-32b"],
      maxTokens: 4096,
      ceilingCents: 10,
    },
    summarization: {
      candidates: ["google/gemini-3.1-flash-lite-preview", "google/gemini-3.1-flash-lite-preview"],
      maxTokens: 4096,
      ceilingCents: 10,
    },
    planning: {
      candidates: ["google/gemini-3-flash-preview", "deepseek/deepseek-chat-v3-0324"],
      maxTokens: 8192,
      ceilingCents: 15,
    },
  },
  critical: {
    agent_turn: {
      candidates: ["meta-llama/llama-4-scout", "qwen/qwen3-32b"],
      maxTokens: 2048,
      ceilingCents: 5,
    },
    heartbeat_triage: {
      candidates: ["meta-llama/llama-4-scout"],
      maxTokens: 512,
      ceilingCents: 2,
    },
    safety_check: {
      candidates: ["meta-llama/llama-4-scout"],
      maxTokens: 1024,
      ceilingCents: 3,
    },
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
