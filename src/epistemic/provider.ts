/**
 * Location: src/epistemic/provider.ts
 * Purpose: Paper money provider — simulates USDC balance in SQLite for local testing
 * Functions: PaperMoneyProvider.getBalance, deposit, deduct, getECS
 * Calls: database KV store
 * Imports: better-sqlite3
 */

import type BetterSqlite3 from "better-sqlite3";
import { ECSScorer } from "./scorer.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("epistemic.provider");

const KV_PAPER_BALANCE = "paper_money_balance_cents";
const KV_ECS_TOTAL = "ecs_total";
const KV_ECS_LAST_CONTRIBUTION = "ecs_last_contribution_at";
const BOOTSTRAP_ECS = 100;

type Database = BetterSqlite3.Database;

export class PaperMoneyProvider {
  private scorer: ECSScorer;

  constructor(
    private db: Database,
    private initialBalanceCents: number = 10000, // $100
    private decayFactor: number = 0.95,
  ) {
    this.scorer = new ECSScorer();
    this.ensureInitialized();
  }

  private ensureInitialized(): void {
    const existing = this.db
      .prepare("SELECT value FROM kv WHERE key = ?")
      .get(KV_PAPER_BALANCE) as { value: string } | undefined;
    if (!existing) {
      this.db
        .prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)")
        .run(KV_PAPER_BALANCE, String(this.initialBalanceCents));
      logger.info(`Paper money initialized: $${(this.initialBalanceCents / 100).toFixed(2)}`);
    }

    // Bootstrap ECS grant
    const ecsExisting = this.db
      .prepare("SELECT value FROM kv WHERE key = ?")
      .get(KV_ECS_TOTAL) as { value: string } | undefined;
    if (!ecsExisting) {
      this.db
        .prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)")
        .run(KV_ECS_TOTAL, String(BOOTSTRAP_ECS));
      this.db
        .prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)")
        .run(KV_ECS_LAST_CONTRIBUTION, new Date().toISOString());
      logger.info(`Bootstrap ECS granted: ${BOOTSTRAP_ECS}`);
    }
  }

  /** Get simulated USDC balance in cents. */
  getBalance(): number {
    const row = this.db
      .prepare("SELECT value FROM kv WHERE key = ?")
      .get(KV_PAPER_BALANCE) as { value: string } | undefined;
    return row ? parseInt(row.value, 10) : 0;
  }

  /** Deduct from paper money balance. Returns false if insufficient. */
  deduct(amountCents: number, reason: string): boolean {
    const current = this.getBalance();
    if (current < amountCents) {
      logger.warn(`Deduction failed: need ${amountCents}c, have ${current}c — ${reason}`);
      return false;
    }
    const newBalance = current - amountCents;
    this.db
      .prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)")
      .run(KV_PAPER_BALANCE, String(newBalance));
    logger.info(`Deducted ${amountCents}c (${reason}). Balance: $${(newBalance / 100).toFixed(2)}`);
    return true;
  }

  /** Deposit to paper money balance. */
  deposit(amountCents: number, reason: string): void {
    const current = this.getBalance();
    const newBalance = current + amountCents;
    this.db
      .prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)")
      .run(KV_PAPER_BALANCE, String(newBalance));
    logger.info(`Deposited ${amountCents}c (${reason}). Balance: $${(newBalance / 100).toFixed(2)}`);
  }

  /** Get effective ECS score with decay applied. */
  getECS(): number {
    const totalRow = this.db
      .prepare("SELECT value FROM kv WHERE key = ?")
      .get(KV_ECS_TOTAL) as { value: string } | undefined;
    const lastContribRow = this.db
      .prepare("SELECT value FROM kv WHERE key = ?")
      .get(KV_ECS_LAST_CONTRIBUTION) as { value: string } | undefined;

    const ecsTotal = totalRow ? parseFloat(totalRow.value) : 0;
    const lastContrib = lastContribRow ? new Date(lastContribRow.value) : new Date();
    const hoursSince = (Date.now() - lastContrib.getTime()) / (1000 * 60 * 60);

    return this.scorer.computeDecay(ecsTotal, hoursSince, this.decayFactor);
  }

  /** Add ECS from a validated finding. */
  addECS(delta: number): void {
    const totalRow = this.db
      .prepare("SELECT value FROM kv WHERE key = ?")
      .get(KV_ECS_TOTAL) as { value: string } | undefined;
    const current = totalRow ? parseFloat(totalRow.value) : 0;
    const newTotal = current + delta;
    this.db
      .prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)")
      .run(KV_ECS_TOTAL, String(newTotal));
    this.db
      .prepare("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)")
      .run(KV_ECS_LAST_CONTRIBUTION, new Date().toISOString());
    logger.info(`ECS +${delta} (total: ${newTotal.toFixed(1)})`);
  }

  /** Get the scorer instance. */
  getScorer(): ECSScorer {
    return this.scorer;
  }
}
