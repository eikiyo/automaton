/**
 * Resource Monitor
 *
 * Continuously monitors the automaton's resources and triggers
 * survival mode transitions when needed.
 */

import type {
  AutomatonConfig,
  AutomatonDatabase,
  ConwayClient,
  AutomatonIdentity,
  FinancialState,
  SurvivalTier,
} from "../types.js";
import { getSurvivalTier, getEpistemicSurvivalTier, formatCredits } from "../conway/credits.js";
import { getUsdcBalance } from "../conway/x402.js";

export interface ResourceStatus {
  financial: FinancialState;
  tier: SurvivalTier;
  previousTier: SurvivalTier | null;
  tierChanged: boolean;
  sandboxHealthy: boolean;
}

/**
 * Check all resources and return current status.
 */
export async function checkResources(
  identity: AutomatonIdentity,
  conway: ConwayClient,
  db: AutomatonDatabase,
  epistemicMode = false,
): Promise<ResourceStatus> {
  let creditsCents = 0;
  let usdcBalance = 0;
  let sandboxHealthy = true;

  if (epistemicMode) {
    // In epistemic mode, "credits" = paper money balance from KV store
    const balStr = db.getKV("paper_money_balance_cents");
    creditsCents = balStr ? parseInt(balStr, 10) : 0;
    // No real USDC or sandbox checks needed
    usdcBalance = 0;
  } else {
    // Check credits
    try {
      creditsCents = await conway.getCreditsBalance();
    } catch {}

    // Check USDC
    try {
      usdcBalance = await getUsdcBalance(identity.address);
    } catch {}

    // Check sandbox health
    try {
      const result = await conway.exec("echo ok", 5000);
      sandboxHealthy = result.exitCode === 0;
    } catch {
      sandboxHealthy = false;
    }
  }

  const financial: FinancialState = {
    creditsCents,
    usdcBalance,
    lastChecked: new Date().toISOString(),
  };

  // In epistemic mode, use ECS for tier; in conway mode, use credits
  let tier: SurvivalTier;
  if (epistemicMode) {
    const ecsStr = db.getKV("ecs_total");
    const ecs = ecsStr ? parseFloat(ecsStr) : 0;
    tier = getEpistemicSurvivalTier(ecs);
  } else {
    tier = getSurvivalTier(creditsCents);
  }

  const prevTierStr = db.getKV("current_tier");
  const previousTier = (prevTierStr as SurvivalTier) || null;
  const tierChanged = previousTier !== null && previousTier !== tier;

  // Store current tier
  db.setKV("current_tier", tier);

  // Store financial state
  db.setKV("financial_state", JSON.stringify(financial));

  return {
    financial,
    tier,
    previousTier,
    tierChanged,
    sandboxHealthy,
  };
}

/**
 * Generate a human-readable resource report.
 */
export function formatResourceReport(status: ResourceStatus): string {
  const lines = [
    `=== RESOURCE STATUS ===`,
    `Credits: ${formatCredits(status.financial.creditsCents)}`,
    `USDC: ${status.financial.usdcBalance.toFixed(6)}`,
    `Tier: ${status.tier}${status.tierChanged ? ` (changed from ${status.previousTier})` : ""}`,
    `Sandbox: ${status.sandboxHealthy ? "healthy" : "UNHEALTHY"}`,
    `Checked: ${status.financial.lastChecked}`,
    `========================`,
  ];
  return lines.join("\n");
}
