import { describe, expect, test } from "vitest";
import { PositionManager } from "../../src/position/PositionManager.js";
import { createPosition } from "../../src/position/PositionState.js";
import { RiskEngine } from "../../src/risk/RiskEngine.js";
import { RiskConfig, PriceTick, TriggerDecision } from "../../src/types.js";

const riskConfig: RiskConfig = {
  stopLossEnabled: true,
  stopLossPct: 20,
  earlyExitEnabled: true,
  earlyExitPct: 5,
  fallingMarketEnabled: true,
  fallingWindowMs: 5_000,
  fallingDropPct: 10,
  consecutiveLowerTicks: 3,
  riskScoreWarning: 30,
  riskScoreHigh: 60,
  riskScoreEmergency: 80,
  fallingWeightPriceDrop: 40,
  fallingWeightLowerTicks: 20,
  fallingWeightAcceleration: 20,
  fallingWeightVolumeImbalance: 10,
  fallingWeightLiquidity: 10,
  trailingStopEnabled: true,
  trailingActivationPct: 10,
  trailingStopPct: 5,
  takeProfitEnabled: true,
  takeProfitLevels: [{ id: "tp1", profitPct: 20, sellPct: 25 }],
  maxPriceImpactBps: 500,
  decisionCooldownMs: 0,
  emergencyOnStaleMarket: true,
  staleMarketMs: 1_500,
  emergencyOnCongestion: true
};

describe("high-volume soak", () => {
  test("maintains 10,000 positions without state corruption", () => {
    const pm = new PositionManager();
    for (let i = 0; i < 10_000; i += 1) {
      pm.upsert(createPosition({
        mint: `MINT-${i}`,
        decimals: 6,
        walletAddress: `WALLET-${i}`,
        amount: 1_000_000,
        amountRaw: 1_000_000_000_000n,
        entryPrice: 1
      }));
    }

    expect(pm.all()).toHaveLength(10_000);
    for (let i = 0; i < 10_000; i += 997) {
      const mint = `MINT-${i}`;
      pm.updatePrice(mint, 0.4);
      pm.applyFill(mint, 50, 200_000);
      const p = pm.get(mint);
      expect(p?.remainingPercentage).toBe(50);
      expect(Number.isFinite(p?.unrealizedPnL ?? 0)).toBe(true);
      expect(Number.isFinite(p?.realizedPnL ?? 0)).toBe(true);
    }
  });

  test("processes a rapid multi-tick crash without producing non-finite risk values", () => {
    const engine = new RiskEngine(riskConfig);
    const position = createPosition({ mint: "CRASH", decimals: 6, walletAddress: "wallet", amount: 1_000, entryPrice: 1 });
    const ticks: PriceTick[] = [
      { mint: "CRASH", price: 0.98, timestamp: Date.now() - 400, volumeBuy: 10, volumeSell: 20 },
      { mint: "CRASH", price: 0.80, timestamp: Date.now() - 300, volumeBuy: 5, volumeSell: 50 },
      { mint: "CRASH", price: 0.50, timestamp: Date.now() - 200, volumeBuy: 2, volumeSell: 100 },
      { mint: "CRASH", price: 0.10, timestamp: Date.now() - 100, volumeBuy: 1, volumeSell: 500 }
    ];

    let lastDecision: TriggerDecision | undefined;
    const history: PriceTick[] = [];
    for (const tick of ticks) {
      history.push(tick);
      position.currentPrice = tick.price;
      lastDecision = engine.evaluate({
        position,
        prices: history,
        liquidity: [],
        hasValidRoute: true,
        priceImpactBps: 100,
        marketDataStale: false,
        rpcCongested: false
      });
      if (lastDecision) {
        expect(Number.isFinite(lastDecision.riskScore)).toBe(true);
        expect(Number.isFinite(lastDecision.pnlPct)).toBe(true);
      }
    }
    expect(lastDecision).toBeDefined();
  });
});
