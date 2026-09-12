import { describe, expect, test } from "vitest";
import { createPosition } from "../src/position/PositionState.js";
import { shouldTriggerTrailingStop, trailingStopPrice } from "../src/risk/TrailingStop.js";

describe("TrailingStop", () => {
  test("calculates stop and triggers", () => {
    const p = createPosition({ mint: "m", decimals: 6, walletAddress: "w", amount: 10, entryPrice: 1 });
    p.highestPrice = 1.3;
    p.currentPrice = 1.19;
    expect(trailingStopPrice(p, 8)).toBeCloseTo(1.196, 5);
    expect(shouldTriggerTrailingStop(p, 20, 8)).toBe(true);
  });

  test("stop never moves downward when highs increase", () => {
    const p = createPosition({ mint: "m", decimals: 6, walletAddress: "w", amount: 10, entryPrice: 1 });
    p.highestPrice = 1.2;
    const first = trailingStopPrice(p, 8);
    p.highestPrice = 1.3;
    const second = trailingStopPrice(p, 8);
    expect(second).toBeGreaterThan(first);
  });
});
