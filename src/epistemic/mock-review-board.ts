/**
 * Location: src/epistemic/mock-review-board.ts
 * Purpose: Mock peer review board — simulates 4 LLM judges with ~60% accept rate
 * Functions: MockReviewBoard.review
 * Calls: PaperMoneyProvider (for $1 fee / $5 reward)
 * Imports: provider
 */

import { createLogger } from "../observability/logger.js";
import type { PaperMoneyProvider } from "./provider.js";

const logger = createLogger("epistemic.review");

export interface ReviewVerdict {
  judge: string;
  verdict: "accept" | "reject";
  reasoning: string;
  scores: {
    novelty: number;
    validity: number;
    coherence: number;
    substance: number;
    integrity: number;
  };
}

export interface ReviewResult {
  submissionId: string;
  accepted: boolean;
  verdicts: ReviewVerdict[];
  summary: string;
  feePaid: number;
  rewardEarned: number;
}

const JUDGE_NAMES = ["Judge-Alpha", "Judge-Beta", "Judge-Gamma", "Judge-Delta"];
const SUBMISSION_FEE_CENTS = 100;  // $1
const ACCEPTANCE_REWARD_CENTS = 500; // $5

const ACCEPT_REASONS = [
  "Finding presents a novel contribution with adequate supporting evidence.",
  "Hypothesis is well-formulated and the validation approach is sound.",
  "Clear research gap identified and addressed with reasonable methodology.",
  "Original synthesis of existing literature with new interpretive framework.",
];

const REJECT_REASONS = [
  "Finding lacks sufficient novelty — similar conclusions exist in cited literature.",
  "Evidence does not adequately support the central claim.",
  "Hypothesis is not sufficiently falsifiable as stated.",
  "Research gap is not well-defined; scope too broad for meaningful contribution.",
  "Citations are too sparse to validate the claims made.",
];

export class MockReviewBoard {
  private acceptRate: number;

  constructor(
    private provider: PaperMoneyProvider,
    acceptRate = 0.6,
  ) {
    this.acceptRate = acceptRate;
  }

  /**
   * Submit a paper for mock peer review.
   * Deducts $1 fee. Awards $5 on acceptance.
   */
  review(title: string, content: string): ReviewResult {
    const submissionId = `sub_${Date.now().toString(36)}`;

    // Deduct submission fee
    const feePaid = this.provider.deduct(SUBMISSION_FEE_CENTS, `submission fee: ${title.slice(0, 50)}`)
      ? SUBMISSION_FEE_CENTS : 0;

    if (feePaid === 0) {
      return {
        submissionId,
        accepted: false,
        verdicts: [],
        summary: "Submission rejected: insufficient funds for $1 submission fee.",
        feePaid: 0,
        rewardEarned: 0,
      };
    }

    // Simulate 4 judges
    // Higher quality content (longer, more structured) gets slightly better odds
    const qualityBonus = Math.min(0.15, content.length / 20000);
    const effectiveRate = Math.min(0.95, this.acceptRate + qualityBonus);

    const verdicts: ReviewVerdict[] = JUDGE_NAMES.map((judge) => {
      const accepts = Math.random() < effectiveRate;
      const scores = {
        novelty: 3 + Math.floor(Math.random() * 7) + (accepts ? 1 : 0),
        validity: 3 + Math.floor(Math.random() * 7) + (accepts ? 1 : 0),
        coherence: 4 + Math.floor(Math.random() * 6),
        substance: 3 + Math.floor(Math.random() * 7) + (accepts ? 1 : 0),
        integrity: 5 + Math.floor(Math.random() * 5),
      };
      const reasons = accepts ? ACCEPT_REASONS : REJECT_REASONS;
      return {
        judge,
        verdict: accepts ? "accept" as const : "reject" as const,
        reasoning: reasons[Math.floor(Math.random() * reasons.length)],
        scores,
      };
    });

    const acceptCount = verdicts.filter((v) => v.verdict === "accept").length;
    const accepted = acceptCount >= 3; // 3/4 majority

    let rewardEarned = 0;
    if (accepted) {
      this.provider.deposit(ACCEPTANCE_REWARD_CENTS, `paper accepted: ${title.slice(0, 50)}`);
      rewardEarned = ACCEPTANCE_REWARD_CENTS;
    }

    const summary = accepted
      ? `Paper ACCEPTED (${acceptCount}/4 judges). Net gain: +$${((rewardEarned - feePaid) / 100).toFixed(2)}.`
      : `Paper REJECTED (${acceptCount}/4 judges). Net loss: -$${(feePaid / 100).toFixed(2)}.`;

    logger.info(summary);

    return {
      submissionId,
      accepted,
      verdicts,
      summary,
      feePaid,
      rewardEarned,
    };
  }
}
