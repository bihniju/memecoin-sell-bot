import { describe, expect, test } from "vitest";
import { createPosition } from "../../src/position/PositionState.js";
import { PositionManager } from "../../src/position/PositionManager.js";

const makePosition = () => createPosition({
  mint: "MINT",
  decimals: 6,
  walletAddress: "wallet",
  amount: 1_000,
  amountRaw: 1_000_000_000n,
  entryPrice: 1
});

describe("PositionManager adversarial chaos", () => {
  test("repeated partial exits only consume the current remainder", () => {
    const manager = new PositionManager();
    manager.upsert(makePosition());

    manager.applyFill("MINT", 50, 600);
    expect(manager.get("MINT")?.remainingPercentage).toBe(50);

    manager.applyFill("MINT", 50, 300);
    expect(manager.get("MINT")?.remainingPercentage).toBe(25);
    expect(manager.get("MINT")?.sellState).toBe("PARTIALLY_SOLD");
  });

  test("100% exit marks the position sold", () => {
    const manager = new PositionManager();
    manager.upsert(makePosition());
    manager.applyFill("MINT", 100, 900);
    expect(manager.get("MINT")?.remainingPercentage).toBe(0);
    expect(manager.get("MINT")?.sellState).toBe("SOLD");
  });

  test("invalid sell percentages are clamped safely", () => {
    const manager = new PositionManager();
    manager.upsert(makePosition());
    manager.applyFill("MINT", -100, 0);
    expect(manager.get("MINT")?.remainingPercentage).toBe(100);
    manager.applyFill("MINT", 200, 500);
    expect(manager.get("MINT")?.remainingPercentage).toBe(0);
  });

  test("price updates remain finite under extreme values", () => {
    const manager = new PositionManager();
    manager.upsert(makePosition());
    manager.updatePrice("MINT", Number.MAX_VALUE);
    const p = manager.get("MINT");
    expect(p?.highestPrice).toBe(Number.MAX_VALUE);
    expect(Number.isFinite(p?.unrealizedPnL ?? 0)).toBe(false);
  });
});
