/**
 * Location: src/epistemic/scorer.ts
 * Purpose: ECS (Epistemic Contribution Score) formula implementation
 * Functions: ECSScorer.compute, ECSScorer.computeDecay
 * Calls: nothing (pure math)
 * Imports: types
 */

export interface ECSWeights {
  novelty: number;
  validity: number;
  coherence: number;
  utility: number;
}

export const DEFAULT_ECS_WEIGHTS: ECSWeights = {
  novelty: 0.4,
  validity: 0.3,
  coherence: 0.15,
  utility: 0.15,
};

export interface ECSInput {
  novelty: number;   // 0-1
  validity: number;  // 0-1
  coherence: number; // 0-1
  utility: number;   // 0-1
}

export class ECSScorer {
  private weights: ECSWeights;

  constructor(weights?: Partial<ECSWeights>) {
    this.weights = { ...DEFAULT_ECS_WEIGHTS, ...weights };
  }

  /**
   * Compute ECS delta for a single finding.
   * Returns a score scaled to match creditsCents magnitude (0-1000 range).
   */
  compute(input: ECSInput): number {
    const raw =
      this.weights.novelty * input.novelty +
      this.weights.validity * input.validity +
      this.weights.coherence * input.coherence +
      this.weights.utility * input.utility;
    return Math.round(raw * 1000);
  }

  /**
   * Apply time-based decay to ECS total.
   * decayFactor=0.95 means ~5% loss per day of inactivity.
   */
  computeDecay(
    ecsTotal: number,
    hoursSinceLastContribution: number,
    decayFactor = 0.95,
  ): number {
    const days = hoursSinceLastContribution / 24;
    return Math.round(ecsTotal * Math.pow(decayFactor, days));
  }
}
