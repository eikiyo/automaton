/**
 * Location: src/epistemic/validation.ts
 * Purpose: Cross-reference validation engine for hypotheses
 * Functions: ValidationEngine.validate
 * Calls: InferenceClient (LLM-as-judge)
 * Imports: types, literature-client
 */

import type { InferenceClient, ChatMessage } from "../types.js";
import type { Paper } from "./literature-client.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("epistemic.validation");

export interface ValidationResult {
  score: number;        // 0-1
  supportingPapers: string[];
  contradictingPapers: string[];
  reasoning: string;
}

export class ValidationEngine {
  constructor(private inference: InferenceClient) {}

  /**
   * Validate a hypothesis against available evidence papers.
   * Uses LLM-as-judge to assess support level.
   */
  async validate(hypothesis: string, evidencePapers: Paper[]): Promise<ValidationResult> {
    if (evidencePapers.length === 0) {
      return {
        score: 0.2,
        supportingPapers: [],
        contradictingPapers: [],
        reasoning: "No evidence papers available for validation.",
      };
    }

    const papersText = evidencePapers
      .slice(0, 10) // Limit to 10 papers for context window
      .map((p, i) => `[${i + 1}] "${p.title}" (${p.year}) — ${p.abstract.slice(0, 300)}`)
      .join("\n\n");

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `You are a scientific peer reviewer validating a hypothesis against available evidence. Respond in this exact JSON format:
{
  "score": 0.0-1.0,
  "supporting_indices": [1, 3],
  "contradicting_indices": [2],
  "reasoning": "Brief explanation of validation assessment"
}
Score guide: 0.0=no support, 0.5=mixed evidence, 1.0=strong support.
Respond ONLY with the JSON object.`,
      },
      {
        role: "user",
        content: `Hypothesis: ${hypothesis}\n\nAvailable evidence:\n${papersText}\n\nValidate this hypothesis against the evidence.`,
      },
    ];

    const response = await this.inference.chat(messages, { maxTokens: 400, temperature: 0.3 });
    const content = response.message?.content || "";

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");
      const parsed = JSON.parse(jsonMatch[0]);

      const supportIdx: number[] = parsed.supporting_indices || [];
      const contradictIdx: number[] = parsed.contradicting_indices || [];

      return {
        score: typeof parsed.score === "number" ? Math.max(0, Math.min(1, parsed.score)) : 0.5,
        supportingPapers: supportIdx
          .filter((i: number) => i > 0 && i <= evidencePapers.length)
          .map((i: number) => evidencePapers[i - 1].title),
        contradictingPapers: contradictIdx
          .filter((i: number) => i > 0 && i <= evidencePapers.length)
          .map((i: number) => evidencePapers[i - 1].title),
        reasoning: parsed.reasoning || "",
      };
    } catch (err: any) {
      logger.warn(`Failed to parse validation response: ${err.message}`);
      return {
        score: 0.4,
        supportingPapers: [],
        contradictingPapers: [],
        reasoning: content.slice(0, 300),
      };
    }
  }
}
