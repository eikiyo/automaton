/**
 * Location: src/epistemic/knowledge-accumulator.ts
 * Purpose: Post-turn meta-learning — extracts insights from agent thinking into persistent knowledge document
 * Functions: KnowledgeAccumulator.ingest, getTopRelevant, regenerateDocument
 * Calls: database, fs
 * Imports: better-sqlite3, fs, path
 */

import fs from "fs";
import path from "path";
import { ulid } from "ulid";
import type BetterSqlite3 from "better-sqlite3";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("epistemic.knowledge");

type Database = BetterSqlite3.Database;

type KnowledgeCategory =
  | "what_works"
  | "what_fails"
  | "technique"
  | "domain_pattern"
  | "submission_pattern";

interface KnowledgeEntry {
  id: string;
  category: KnowledgeCategory;
  content: string;
  confidence: number;
  timesConfirmed: number;
  timesContradicted: number;
  sourceTurnIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface Classification {
  category: KnowledgeCategory;
  insight: string;
  confidence: number;
}

export class KnowledgeAccumulator {
  private knowledgePath: string;

  constructor(private db: Database) {
    this.knowledgePath = path.join(
      process.env.HOME || "/root",
      ".automaton",
      "knowledge.md",
    );
    this.ensureTable();
  }

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        source_turn_ids TEXT DEFAULT '[]',
        times_confirmed INTEGER DEFAULT 1,
        times_contradicted INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ke_category ON knowledge_entries(category);
      CREATE INDEX IF NOT EXISTS idx_ke_confidence ON knowledge_entries(confidence);
    `);
  }

  /**
   * Called after every turn. Extracts meta-insights from agent's thinking.
   */
  async ingest(turnId: string, thinking: string): Promise<void> {
    if (!thinking || thinking.length < 50) return;

    const classification = this.classify(thinking);
    if (!classification) return;

    // Check for existing similar entry (simple text match — no embeddings needed for meta-learning)
    const similar = this.findSimilarByText(classification.insight);

    if (similar) {
      this.strengthen(similar.id, turnId);
    } else {
      this.addEntry(classification, turnId);
    }

    this.regenerateDocument();
  }

  private classify(thinking: string): Classification | null {
    const text = thinking.toLowerCase();

    // Success patterns
    if (text.includes("this worked") || text.includes("successfully") || text.includes("accepted")) {
      if (text.includes("accepted") || text.includes("submission")) {
        return { category: "submission_pattern", insight: this.extractInsight(thinking, "success"), confidence: 0.9 };
      }
      return { category: "what_works", insight: this.extractInsight(thinking, "success"), confidence: 0.8 };
    }

    // Failure patterns
    if (text.includes("failed") || text.includes("rejected") || text.includes("error") || text.includes("didn't work")) {
      if (text.includes("rejected") || text.includes("submission")) {
        return { category: "submission_pattern", insight: this.extractInsight(thinking, "failure"), confidence: 0.9 };
      }
      return { category: "what_fails", insight: this.extractInsight(thinking, "failure"), confidence: 0.8 };
    }

    // Technique patterns
    if (text.includes("technique") || text.includes("method") || text.includes("approach") || text.includes("strategy")) {
      return { category: "technique", insight: this.extractInsight(thinking, "technique"), confidence: 0.7 };
    }

    // Domain patterns
    if (text.includes("domain") || text.includes("field") || text.includes("literature") || text.includes("papers show")) {
      return { category: "domain_pattern", insight: this.extractInsight(thinking, "domain"), confidence: 0.7 };
    }

    return null;
  }

  private extractInsight(thinking: string, type: string): string {
    // Extract the most relevant sentence(s) — first 200 chars of the thinking
    // that contain the classification keywords
    const sentences = thinking.split(/[.!?]+/).filter((s) => s.trim().length > 20);
    const relevant = sentences.find((s) => {
      const lower = s.toLowerCase();
      switch (type) {
        case "success": return lower.includes("work") || lower.includes("success") || lower.includes("accept");
        case "failure": return lower.includes("fail") || lower.includes("reject") || lower.includes("error");
        case "technique": return lower.includes("method") || lower.includes("approach") || lower.includes("technique");
        case "domain": return lower.includes("domain") || lower.includes("field") || lower.includes("literature");
        default: return true;
      }
    });
    return (relevant || sentences[0] || thinking).trim().slice(0, 200);
  }

  private findSimilarByText(insight: string): KnowledgeEntry | null {
    // Simple word overlap similarity — good enough for meta-learning
    const words = new Set(insight.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    const entries = this.db
      .prepare("SELECT * FROM knowledge_entries WHERE confidence > 0.3")
      .all() as any[];

    for (const e of entries) {
      const eWords = new Set(e.content.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3));
      const intersection = [...words].filter((w) => eWords.has(w)).length;
      const union = new Set([...words, ...eWords]).size;
      const jaccard = union > 0 ? intersection / union : 0;
      if (jaccard > 0.5) {
        return {
          id: e.id,
          category: e.category,
          content: e.content,
          confidence: e.confidence,
          timesConfirmed: e.times_confirmed,
          timesContradicted: e.times_contradicted,
          sourceTurnIds: JSON.parse(e.source_turn_ids || "[]"),
          createdAt: e.created_at,
          updatedAt: e.updated_at,
        };
      }
    }
    return null;
  }

  private strengthen(entryId: string, turnId: string): void {
    const entry = this.db
      .prepare("SELECT * FROM knowledge_entries WHERE id = ?")
      .get(entryId) as any;
    if (!entry) return;

    const turnIds = JSON.parse(entry.source_turn_ids || "[]");
    turnIds.push(turnId);
    const newConfidence = Math.min(1.0, entry.confidence + 0.05);

    this.db
      .prepare(
        `UPDATE knowledge_entries SET times_confirmed = times_confirmed + 1,
         confidence = ?, source_turn_ids = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(newConfidence, JSON.stringify(turnIds.slice(-20)), entryId);

    logger.debug(`Knowledge entry strengthened: ${entryId} (confidence: ${newConfidence.toFixed(2)})`);
  }

  private addEntry(classification: Classification, turnId: string): void {
    const id = ulid();
    this.db
      .prepare(
        `INSERT INTO knowledge_entries (id, category, content, confidence, source_turn_ids, times_confirmed)
         VALUES (?, ?, ?, ?, ?, 1)`,
      )
      .run(id, classification.category, classification.insight, classification.confidence, JSON.stringify([turnId]));

    logger.info(`New knowledge entry: [${classification.category}] ${classification.insight.slice(0, 80)}`);
  }

  /**
   * Get top N most relevant knowledge entries.
   * Used for system prompt injection.
   */
  getTopRelevant(limit = 5): KnowledgeEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM knowledge_entries WHERE confidence > 0.4
         ORDER BY confidence DESC, times_confirmed DESC LIMIT ?`,
      )
      .all(limit) as any[];

    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      content: r.content,
      confidence: r.confidence,
      timesConfirmed: r.times_confirmed,
      timesContradicted: r.times_contradicted,
      sourceTurnIds: JSON.parse(r.source_turn_ids || "[]"),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  /**
   * Regenerate the human-readable knowledge.md from DB entries.
   */
  regenerateDocument(): void {
    const entries = this.db
      .prepare("SELECT * FROM knowledge_entries WHERE confidence > 0.3 ORDER BY confidence DESC")
      .all() as any[];

    const sections: Record<string, string[]> = {
      what_works: [],
      what_fails: [],
      technique: [],
      domain_pattern: [],
      submission_pattern: [],
    };

    for (const e of entries) {
      const conf = `[${(e.confidence * 100).toFixed(0)}%]`;
      const list = sections[e.category as KnowledgeCategory];
      if (list) {
        list.push(`- ${conf} ${e.content} (confirmed ${e.times_confirmed}x)`);
      }
    }

    const md = [
      "# Knowledge Document",
      `Updated: ${new Date().toISOString()}`,
      `Total entries: ${entries.length}`,
      "",
      "## What Works",
      ...(sections.what_works.length > 0 ? sections.what_works : ["- (no entries yet)"]),
      "",
      "## What Doesn't Work",
      ...(sections.what_fails.length > 0 ? sections.what_fails : ["- (no entries yet)"]),
      "",
      "## Research Techniques",
      ...(sections.technique.length > 0 ? sections.technique : ["- (no entries yet)"]),
      "",
      "## Domain-Specific Patterns",
      ...(sections.domain_pattern.length > 0 ? sections.domain_pattern : ["- (no entries yet)"]),
      "",
      "## Submission Patterns",
      ...(sections.submission_pattern.length > 0 ? sections.submission_pattern : ["- (no entries yet)"]),
    ].join("\n");

    try {
      const dir = path.dirname(this.knowledgePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(this.knowledgePath, md, { mode: 0o600 });
    } catch (err: any) {
      logger.warn(`Failed to write knowledge.md: ${err.message}`);
    }
  }

  /** Get full knowledge document text. */
  getDocument(): string {
    try {
      if (fs.existsSync(this.knowledgePath)) {
        return fs.readFileSync(this.knowledgePath, "utf-8");
      }
    } catch {}
    return "# Knowledge Document\n\nNo entries yet.";
  }
}
