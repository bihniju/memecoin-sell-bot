import { describe, expect, test } from "vitest";
import { PriorityFeeManager } from "../../src/execution/PriorityFeeManager.js";
import type { ExecutionConfig, TriggerDecision } from "../../src/types.js";

const config: ExecutionConfig = {
  maxSellRetries: 3,
  priorityFeeEnabled: true,
  priorityFeeMode: "dynamic",
  minPriorityFeeMicrolamports: 1_000,
  maxPriorityFeeMicrolamports: 100_000,
  emergencyPriorityFeeMicrolamports: 250_000,
  quoteSlippageBps: 100,
  quoteStaleMs: 500,
  skipPreflight: true,
  maxRpcSendRetries: 2,
  confirmationTimeoutMs: 1_000,
  simulationLatencyMs: 0
};

const decision = (trigger: TriggerDecision["trigger"], riskScore: number): TriggerDecision => ({
  trigger,
  reason: "chaos",
  timestamp: Date.now(),
  price: 1,
  entryPrice: 1,
  pnlPct: 0,
  riskScore,
  sellPct: 100
});

describe("PriorityFeeManager congestion chaos", () => {
  test("emergency exits use the emergency fee immediately", async () => {
    const manager = new PriorityFeeManager(config, { getRecentPriorityFeeMicrolamports: async () => 2_000 });
    expect(await manager.resolveFee(decision("EMERGENCY", 100), 1)).toBe(250_000);
  });

  test("sampled network fees are clamped to configured bounds", async () => {
    const manager = new PriorityFeeManager(config, { getRecentPriorityFeeMicrolamports: async () => 1_000_000 });
    const fee = await manager.resolveFee(decision("RAPID_DECLINE", 70), 1);
    expect(fee).toBeLessThanOrEqual(100_000);
    expect(fee).toBeGreaterThanOrEqual(1_000);
  });

  test("retry attempts escalate dynamic fees without exceeding the cap", async () => {
    const manager = new PriorityFeeManager(config, { getRecentPriorityFeeMicrolamports: async () => undefined });
    const first = await manager.resolveFee(decision("RAPID_DECLINE", 20), 1);
    const last = await manager.resolveFee(decision("RAPID_DECLINE", 100), 3);
    expect(last).toBeGreaterThan(first);
    expect(last).toBeLessThanOrEqual(config.maxPriorityFeeMicrolamports);
  });
});
