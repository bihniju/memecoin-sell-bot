import { describe, expect, test } from "vitest";
import { createPosition } from "../src/position/PositionState.js";
import { RiskEngine } from "../src/risk/RiskEngine.js";
const config = {
    stopLossEnabled: true,
    stopLossPct: 5,
    earlyExitEnabled: true,
    earlyExitPct: 2,
    fallingMarketEnabled: true,
    fallingWindowMs: 3000,
    fallingDropPct: 1.5,
    consecutiveLowerTicks: 3,
    riskScoreWarning: 40,
    riskScoreHigh: 60,
    riskScoreEmergency: 80,
    fallingWeightPriceDrop: 40,
    fallingWeightLowerTicks: 20,
    fallingWeightAcceleration: 20,
    fallingWeightVolumeImbalance: 10,
    fallingWeightLiquidity: 10,
    trailingStopEnabled: true,
    trailingActivationPct: 20,
    trailingStopPct: 8,
    takeProfitEnabled: true,
    takeProfitLevels: [
        { id: "tp1", profitPct: 20, sellPct: 25 },
        { id: "tp2", profitPct: 40, sellPct: 25 }
    ],
    maxPriceImpactBps: 1500
};
describe("RiskEngine", () => {
    test("triggers stop loss", () => {
        const p = createPosition({ mint: "m", decimals: 6, walletAddress: "w", amount: 10, entryPrice: 1 });
        p.currentPrice = 0.94;
        const engine = new RiskEngine(config);
        const decision = engine.evaluate({
            position: p,
            prices: [
                { mint: "m", price: 1, timestamp: 1 },
                { mint: "m", price: 0.96, timestamp: 2 },
                { mint: "m", price: 0.94, timestamp: 3 }
            ],
            liquidity: [],
            hasValidRoute: true,
            priceImpactBps: 300
        });
        expect(decision?.trigger).toBe("RAPID_DECLINE");
    });
    test("uses priority when multiple triggers fire", () => {
        const p = createPosition({ mint: "m", decimals: 6, walletAddress: "w", amount: 10, entryPrice: 1 });
        p.currentPrice = 0.8;
        const engine = new RiskEngine(config);
        const decision = engine.evaluate({
            position: p,
            prices: [
                { mint: "m", price: 1, timestamp: 1, volumeBuy: 1, volumeSell: 20 },
                { mint: "m", price: 0.9, timestamp: 2, volumeBuy: 1, volumeSell: 30 },
                { mint: "m", price: 0.8, timestamp: 3, volumeBuy: 1, volumeSell: 40 }
            ],
            liquidity: [
                { mint: "m", liquidityUsd: 1000, timestamp: 1 },
                { mint: "m", liquidityUsd: 100, timestamp: 2 }
            ],
            hasValidRoute: false,
            priceImpactBps: 3000
        });
        expect(decision?.trigger).toBe("LIQUIDITY_COLLAPSE");
    });
});
