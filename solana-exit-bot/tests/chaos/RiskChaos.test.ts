import { describe, expect, test } from "vitest";
import { RiskEngine } from "../../src/risk/RiskEngine.js";
import { createPosition } from "../../src/position/PositionState.js";
import type { RiskConfig } from "../../src/types.js";

const config: RiskConfig = {
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
  trailingStopEnabled: false,
  trailingActivationPct: 10,
  trailingStopPct: 5,
  takeProfitEnabled: false,
  takeProfitLevels: [],
  maxPriceImpactBps: 500,
  decisionCooldownMs: 0,
  emergencyOnStaleMarket: true,
  staleMarketMs: 1_500,
  emergencyOnCongestion: true
};

const position = () => createPosition({
  mint: "MINT",
  decimals: 6,
  walletAddress: "wallet",
  amount: 1_000,
  amountRaw: 1_000_000_000n,
  entryPrice: 1
});

describe("RiskEngine adversarial chaos", () => {
  test("detects a catastrophic price crash", () => {
    const engine = new RiskEngine(config);
    const p = position();
    p.currentPrice = 0.1;
    const decision = engine.evaluate({
      position: p,
      prices: [
        { mint: p.mint, price: 1, timestamp: 1 },
        { mint: p.mint, price: 0.98, timestamp: 2 },
        { mint: p.mint, price: 0.7, timestamp: 3 },
        { mint: p.mint, price: 0.1, timestamp: 4 }
      ],
      liquidity: [],
      hasValidRoute: true
    });
    expect(decision?.trigger).toBe("RAPID_DECLINE");
  });

  test("treats extreme executable price impact as liquidity collapse", () => {
    const engine = new RiskEngine(config);
    const p = position();
    const decision = engine.evaluate({
      position: p,
      prices: [{ mint: p.mint, price: 1, timestamp: 1 }],
      liquidity: [],
      hasValidRoute: true,
      priceImpactBps: 1_000
    });
    expect(decision?.trigger).toBe("LIQUIDITY_COLLAPSE");
  });

  test("detects a completely unavailable exit route", () => {
    const engine = new RiskEngine(config);
    const p = position();
    const decision = engine.evaluate({
      position: p,
      prices: [{ mint: p.mint, price: 1, timestamp: 1 }],
      liquidity: [],
      hasValidRoute: false
    });
    expect(decision?.trigger).toBe("NO_VALID_ROUTE");
  });

  test("stale market data escalates to emergency", () => {
    const engine = new RiskEngine(config);
    const p = position();
    const decision = engine.evaluate({
      position: p,
      prices: [{ mint: p.mint, price: 1, timestamp: 1 }],
      liquidity: [],
      hasValidRoute: true,
      marketDataStale: true
    });
    expect(decision?.trigger).toBe("EMERGENCY");
  });

  test("RPC congestion alone does not force a blind emergency sell", () => {
    const engine = new RiskEngine(config);
    const p = position();
    const decision = engine.evaluate({
      position: p,
      prices: [{ mint: p.mint, price: 1, timestamp: 1 }],
      liquidity: [],
      hasValidRoute: true,
      rpcCongested: true
    });
    expect(decision).toBeUndefined();
  });

  test("combined congestion and stale market data escalates", () => {
    const engine = new RiskEngine(config);
    const p = position();
    const decision = engine.evaluate({
      position: p,
      prices: [{ mint: p.mint, price: 1, timestamp: 1 }],
      liquidity: [],
      hasValidRoute: true,
      rpcCongested: true,
      marketDataStale: true
    });
    expect(decision?.trigger).toBe("EMERGENCY");
  });
});
