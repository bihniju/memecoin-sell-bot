import { describe, expect, test } from "vitest";
import { PriorityFeeManager } from "../src/execution/PriorityFeeManager.js";
const config = {
    maxSellRetries: 3,
    priorityFeeEnabled: true,
    priorityFeeMode: "dynamic",
    minPriorityFeeMicrolamports: 1000,
    maxPriorityFeeMicrolamports: 10000,
    emergencyPriorityFeeMicrolamports: 20000,
    quoteSlippageBps: 250,
    quoteStaleMs: 1500,
    skipPreflight: false,
    maxRpcSendRetries: 2,
    confirmationTimeoutMs: 5000,
    simulationLatencyMs: 50
};
const decision = {
    trigger: "RAPID_DECLINE",
    reason: "risk",
    timestamp: Date.now(),
    price: 1,
    entryPrice: 1,
    pnlPct: 0,
    riskScore: 80,
    sellPct: 100
};
describe("PriorityFeeManager", () => {
    test("dynamic mode uses sampled network fees", async () => {
        const manager = new PriorityFeeManager(config, {
            async getRecentPriorityFeeMicrolamports() {
                return 7000;
            }
        });
        const fee = await manager.resolveFee(decision, 1);
        expect(fee).toBeGreaterThanOrEqual(7000);
        expect(fee).toBeLessThanOrEqual(config.maxPriorityFeeMicrolamports);
    });
    test("emergency mode returns emergency fee", async () => {
        const manager = new PriorityFeeManager(config);
        const fee = await manager.resolveFee({ ...decision, trigger: "EMERGENCY" }, 1, true);
        expect(fee).toBe(config.emergencyPriorityFeeMicrolamports);
    });
});
