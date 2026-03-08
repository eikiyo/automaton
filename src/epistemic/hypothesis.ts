/**
 * Location: src/epistemic/hypothesis.ts
 * Purpose: Structured hypothesis generation from knowledge gaps
 * Functions: HypothesisGenerator.generate
 * Calls: InferenceClient (Gemini via OpenAI-compatible API)
 * Imports: types
 */

import type { InferenceClient, ChatMessage } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("epistemic.hypothesis");

export interface KnowledgeGap {
  id: string;
  domain: string;
  description: string;
  sourcePapers: string[]; // titles or DOIs
}

export interface Hypothesis {
  id: string;
  statement: string;
  predictedEvidence: string;
  falsificationCriteria: string;
  confidence: number; // 0-1
  sourceGap: string;
}

export class HypothesisGenerator {
  constructor(private inference: InferenceClient) {}

  async generate(gap: KnowledgeGap, contextPapers: string[]): Promise<Hypothesis> {
    const papersContext = contextPapers.length > 0
      ? `\n\nRelevant papers for context:\n${contextPapers.map((p, i) => `${i + 1}. ${p}`).join("\n")}`
      : "";

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `You are a research hypothesis generator. Given a knowledge gap, produce a testable, falsifiable hypothesis. Respond in this exact JSON format:
{
  "statement": "The hypothesis statement",
  "predicted_evidence": "What evidence would support this hypothesis",
  "falsification_criteria": "What would disprove this hypothesis",
  "confidence": 0.0-1.0
}
Respond ONLY with the JSON object, no markdown or other text.`,
      },
      {
        role: "user",
        content: `Knowledge gap in ${gap.domain}:\n${gap.description}${papersContext}\n\nGenerate a testable hypothesis for this gap.`,
      },
    ];

    const response = await this.inference.chat(messages, { maxTokens: 500, temperature: 0.7 });
    const content = response.message?.content || "";

    try {
      // Try to extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");
      const parsed = JSON.parse(jsonMatch[0]);

      const id = `hyp_${Date.now().toString(36)}`;
      return {
        id,
        statement: parsed.statement || "No hypothesis generated",
        predictedEvidence: parsed.predicted_evidence || "",
        falsificationCriteria: parsed.falsification_criteria || "",
        confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        sourceGap: gap.id,
      };
    } catch (err: any) {
      logger.warn(`Failed to parse hypothesis response: ${err.message}`);
      return {
        id: `hyp_${Date.now().toString(36)}`,
        statement: content.slice(0, 500),
        predictedEvidence: "",
        falsificationCriteria: "",
        confidence: 0.3,
        sourceGap: gap.id,
      };
    }
  }
}
