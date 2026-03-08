/**
 * Location: src/epistemic/novelty.ts
 * Purpose: Embedding-based novelty scoring using Gemini embeddings
 * Functions: NoveltyScorer.score, embed, cosineSimilarity
 * Calls: Gemini embedding API
 * Imports: ResilientHttpClient
 */

import { ResilientHttpClient } from "../conway/http-client.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("epistemic.novelty");

const GEMINI_EMBED_URL = "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent";

export class NoveltyScorer {
  private http: ResilientHttpClient;
  private apiKey: string;
  private cache = new Map<string, number[]>();

  constructor(apiKey: string) {
    this.http = new ResilientHttpClient({
      baseTimeout: 10000,
      maxRetries: 2,
      backoffBase: 1000,
    });
    this.apiKey = apiKey;
  }

  /**
   * Score novelty of a finding against a set of comparison texts.
   * Returns 0-1 where 1 = maximally novel (no similar existing work).
   */
  async score(finding: string, comparisonTexts: string[]): Promise<number> {
    if (comparisonTexts.length === 0) return 0.8; // No corpus = assume moderately novel

    const findingEmbed = await this.embed(finding);
    if (!findingEmbed) return 0.5; // API failure = neutral score

    let maxSimilarity = 0;
    for (const text of comparisonTexts) {
      const textEmbed = await this.embed(text);
      if (textEmbed) {
        const sim = this.cosineSimilarity(findingEmbed, textEmbed);
        if (sim > maxSimilarity) maxSimilarity = sim;
      }
    }

    // Novelty = 1 - max_similarity
    const novelty = Math.max(0, Math.min(1, 1 - maxSimilarity));
    logger.info(`Novelty score: ${novelty.toFixed(3)} (max similarity: ${maxSimilarity.toFixed(3)} across ${comparisonTexts.length} texts)`);
    return novelty;
  }

  /** Embed text using Gemini embedding API. */
  async embed(text: string): Promise<number[] | null> {
    // Check cache
    const cacheKey = text.slice(0, 200);
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;

    try {
      const url = `${GEMINI_EMBED_URL}?key=${this.apiKey}`;
      const response = await this.http.request(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/text-embedding-004",
          content: { parts: [{ text: text.slice(0, 2048) }] },
        }),
      });

      if (!response.ok) {
        logger.warn(`Gemini embed API returned ${response.status}`);
        return null;
      }

      const data = await response.json() as any;
      const values = data.embedding?.values;
      if (!values || !Array.isArray(values)) return null;

      // Cache it
      this.cache.set(cacheKey, values);
      if (this.cache.size > 500) {
        // Evict oldest entries
        const keys = [...this.cache.keys()];
        for (let i = 0; i < 100; i++) this.cache.delete(keys[i]);
      }

      return values;
    } catch (err: any) {
      logger.warn(`Embedding failed: ${err.message}`);
      return null;
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }
}
