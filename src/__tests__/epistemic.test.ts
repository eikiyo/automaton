/**
 * Epistemic Module Tests
 *
 * Tests: ECS scorer, PaperMoneyProvider, MockReviewBoard,
 * knowledge accumulator, and tool creation.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ECSScorer, DEFAULT_ECS_WEIGHTS } from "../epistemic/scorer.js";
import { PaperMoneyProvider } from "../epistemic/provider.js";
import { MockReviewBoard } from "../epistemic/mock-review-board.js";
import { KnowledgeAccumulator } from "../epistemic/knowledge-accumulator.js";
import { createEpistemicTools } from "../epistemic/tools.js";
import { DEFAULT_EPISTEMIC_CONFIG } from "../types.js";
import { MIGRATION_V11 } from "../state/schema.js";

// ─── Test Helpers ───────────────────────────────────────────────

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  // Create minimal tables needed by epistemic modules
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(MIGRATION_V11);
  return db;
}

// ─── ECSScorer ──────────────────────────────────────────────────

describe("ECSScorer", () => {
  let scorer: ECSScorer;

  beforeEach(() => {
    scorer = new ECSScorer();
  });

  it("computes ECS with default weights", () => {
    const result = scorer.compute({
      novelty: 1.0,
      validity: 1.0,
      coherence: 1.0,
      utility: 1.0,
    });
    // (0.4*1 + 0.3*1 + 0.15*1 + 0.15*1) * 1000 = 1000
    expect(result).toBe(1000);
  });

  it("computes ECS with partial scores", () => {
    const result = scorer.compute({
      novelty: 0.5,
      validity: 0.8,
      coherence: 0.6,
      utility: 0.0,
    });
    // (0.4*0.5 + 0.3*0.8 + 0.15*0.6 + 0.15*0) * 1000 = (0.2+0.24+0.09+0)*1000 = 530
    expect(result).toBe(530);
  });

  it("returns 0 for zero inputs", () => {
    const result = scorer.compute({
      novelty: 0,
      validity: 0,
      coherence: 0,
      utility: 0,
    });
    expect(result).toBe(0);
  });

  it("accepts custom weights", () => {
    const custom = new ECSScorer({ novelty: 1.0, validity: 0, coherence: 0, utility: 0 });
    const result = custom.compute({
      novelty: 0.5,
      validity: 1.0,
      coherence: 1.0,
      utility: 1.0,
    });
    // 1.0*0.5 * 1000 = 500
    expect(result).toBe(500);
  });

  it("computes decay correctly", () => {
    // 100 ECS, 24 hours since last contribution, 0.95 decay
    const result = scorer.computeDecay(100, 24, 0.95);
    expect(result).toBe(95); // 100 * 0.95^1 = 95

    // 100 ECS, 48 hours (2 days)
    const result2 = scorer.computeDecay(100, 48, 0.95);
    expect(result2).toBe(90); // 100 * 0.95^2 = 90.25 -> 90

    // 0 hours = no decay
    const result3 = scorer.computeDecay(100, 0, 0.95);
    expect(result3).toBe(100);
  });

  it("decay approaches zero over time", () => {
    // After 90 days, very little remains
    const result = scorer.computeDecay(1000, 90 * 24, 0.95);
    expect(result).toBeLessThanOrEqual(10);
  });
});

// ─── PaperMoneyProvider ─────────────────────────────────────────

describe("PaperMoneyProvider", () => {
  let db: Database.Database;
  let provider: PaperMoneyProvider;

  beforeEach(() => {
    db = createTestDb();
    provider = new PaperMoneyProvider(db, 10000, 0.95);
  });

  afterEach(() => {
    db.close();
  });

  it("initializes with correct balance", () => {
    expect(provider.getBalance()).toBe(10000); // $100
  });

  it("initializes with bootstrap ECS", () => {
    const ecs = provider.getECS();
    expect(ecs).toBe(100); // bootstrap grant
  });

  it("deducts balance successfully", () => {
    const result = provider.deduct(500, "test deduction");
    expect(result).toBe(true);
    expect(provider.getBalance()).toBe(9500);
  });

  it("rejects insufficient balance deduction", () => {
    const result = provider.deduct(20000, "too much");
    expect(result).toBe(false);
    expect(provider.getBalance()).toBe(10000); // unchanged
  });

  it("deposits to balance", () => {
    provider.deposit(1000, "test deposit");
    expect(provider.getBalance()).toBe(11000);
  });

  it("adds ECS correctly", () => {
    provider.addECS(50);
    // Bootstrap (100) + 50 = 150, but getECS applies decay
    // Since just added, decay should be negligible
    const ecs = provider.getECS();
    expect(ecs).toBe(150);
  });

  it("ECS decays over time", () => {
    // Set last contribution to 48 hours ago
    db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)")
      .run("ecs_last_contribution_at", new Date(Date.now() - 48 * 3600 * 1000).toISOString());

    const ecs = provider.getECS();
    // 100 * 0.95^2 = 90.25 -> 90
    expect(ecs).toBe(90);
  });

  it("does not re-initialize on second construction", () => {
    provider.deposit(5000, "extra");
    expect(provider.getBalance()).toBe(15000);

    // Create another provider on the same DB
    const provider2 = new PaperMoneyProvider(db, 10000, 0.95);
    expect(provider2.getBalance()).toBe(15000); // preserved, not reset
  });
});

// ─── MockReviewBoard ────────────────────────────────────────────

describe("MockReviewBoard", () => {
  let db: Database.Database;
  let provider: PaperMoneyProvider;

  beforeEach(() => {
    db = createTestDb();
    provider = new PaperMoneyProvider(db, 10000, 0.95);
  });

  afterEach(() => {
    db.close();
  });

  it("deducts submission fee on review", () => {
    const board = new MockReviewBoard(provider, 0.6);
    const balanceBefore = provider.getBalance();
    board.review("Test Paper", "Some content about research");
    const balanceAfter = provider.getBalance();

    // Fee of $1 (100 cents) is always deducted
    // If accepted, $5 (500 cents) is deposited
    // So balance changes by either -100 or +400
    const diff = balanceAfter - balanceBefore;
    expect(diff === -100 || diff === 400).toBe(true);
  });

  it("rejects submission with insufficient funds", () => {
    // Drain balance
    provider.deduct(10000, "drain");
    const board = new MockReviewBoard(provider, 0.6);
    const result = board.review("Test", "Content");

    expect(result.accepted).toBe(false);
    expect(result.feePaid).toBe(0);
    expect(result.verdicts).toHaveLength(0);
    expect(result.summary).toContain("insufficient funds");
  });

  it("returns 4 judge verdicts", () => {
    const board = new MockReviewBoard(provider, 0.6);
    const result = board.review("Test Paper", "Research content here");
    expect(result.verdicts).toHaveLength(4);
    for (const v of result.verdicts) {
      expect(["accept", "reject"]).toContain(v.verdict);
      expect(v.scores.novelty).toBeGreaterThanOrEqual(3);
      expect(v.scores.novelty).toBeLessThanOrEqual(11);
    }
  });

  it("accepts with 100% accept rate", () => {
    const board = new MockReviewBoard(provider, 1.0);
    const result = board.review("Great Paper", "Excellent findings");
    expect(result.accepted).toBe(true);
    expect(result.rewardEarned).toBe(500);
  });

  it("rejects with 0% accept rate", () => {
    const board = new MockReviewBoard(provider, 0.0);
    const result = board.review("Bad Paper", "No findings");
    expect(result.accepted).toBe(false);
    expect(result.rewardEarned).toBe(0);
  });

  it("gives quality bonus for longer content", () => {
    const board = new MockReviewBoard(provider, 0.5);
    // Quality bonus is capped at 0.15 for 20000+ chars
    const longContent = "Research ".repeat(3000); // ~24000 chars
    const result = board.review("Long Paper", longContent);
    // With 50% base + 15% bonus = 65% effective rate, not guaranteed
    // Just verify it returns a valid result
    expect(result.submissionId).toBeTruthy();
    expect(result.verdicts).toHaveLength(4);
  });
});

// ─── KnowledgeAccumulator ───────────────────────────────────────

describe("KnowledgeAccumulator", () => {
  let db: Database.Database;
  let accumulator: KnowledgeAccumulator;

  beforeEach(() => {
    db = createTestDb();
    accumulator = new KnowledgeAccumulator(db);
  });

  afterEach(() => {
    db.close();
  });

  it("ignores short thinking text", async () => {
    await accumulator.ingest("turn1", "short");
    const entries = accumulator.getTopRelevant(10);
    expect(entries).toHaveLength(0);
  });

  it("classifies success patterns", async () => {
    await accumulator.ingest("turn1", "This approach worked successfully when we applied the new research methodology to the dataset and got good results.");
    const entries = accumulator.getTopRelevant(10);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].category).toBe("what_works");
  });

  it("classifies failure patterns", async () => {
    await accumulator.ingest("turn1", "The hypothesis testing approach failed because the evidence did not support the predicted outcome and the method was flawed.");
    const entries = accumulator.getTopRelevant(10);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].category).toBe("what_fails");
  });

  it("classifies submission patterns", async () => {
    await accumulator.ingest("turn1", "The paper submission was rejected by the review board because the findings lacked sufficient novelty and evidence.");
    const entries = accumulator.getTopRelevant(10);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].category).toBe("submission_pattern");
  });

  it("strengthens repeated entries", async () => {
    const thinking = "This research technique worked successfully when we applied systematic literature reviews to identify knowledge gaps.";
    await accumulator.ingest("turn1", thinking);
    await accumulator.ingest("turn2", thinking);

    const entries = accumulator.getTopRelevant(10);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].timesConfirmed).toBeGreaterThanOrEqual(2);
  });

  it("generates knowledge document", () => {
    const doc = accumulator.getDocument();
    expect(doc).toContain("Knowledge Document");
  });
});

// ─── createEpistemicTools ───────────────────────────────────────

describe("createEpistemicTools", () => {
  it("returns all 10 research tools", () => {
    const tools = createEpistemicTools(DEFAULT_EPISTEMIC_CONFIG);
    expect(tools.length).toBe(10);

    const names = tools.map((t) => t.name);
    expect(names).toContain("scan_literature");
    expect(names).toContain("read_paper");
    expect(names).toContain("hypothesize");
    expect(names).toContain("validate_hypothesis");
    expect(names).toContain("score_novelty");
    expect(names).toContain("identify_gaps");
    expect(names).toContain("write_latex");
    expect(names).toContain("update_thesis");
    expect(names).toContain("submit_for_review");
    expect(names).toContain("check_ecs");
  });

  it("all tools have research category", () => {
    const tools = createEpistemicTools(DEFAULT_EPISTEMIC_CONFIG);
    for (const tool of tools) {
      expect(tool.category).toBe("research");
    }
  });

  it("all tools have required parameters", () => {
    const tools = createEpistemicTools(DEFAULT_EPISTEMIC_CONFIG);
    for (const tool of tools) {
      expect(tool.parameters).toBeDefined();
      expect(tool.execute).toBeDefined();
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("check_ecs tool works with mock db", async () => {
    const db = createTestDb();
    const tools = createEpistemicTools(DEFAULT_EPISTEMIC_CONFIG);
    const checkEcs = tools.find((t) => t.name === "check_ecs")!;

    const mockCtx = {
      db: { raw: db } as any,
      identity: {} as any,
      config: { epistemicConfig: DEFAULT_EPISTEMIC_CONFIG } as any,
      conway: {} as any,
      inference: {} as any,
    };

    const result = await checkEcs.execute({}, mockCtx);
    expect(result).toContain("ECS (effective):");
    expect(result).toContain("Survival Tier:");
    expect(result).toContain("Paper Money Balance:");

    db.close();
  });
});
