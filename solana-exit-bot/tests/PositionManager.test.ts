import { describe, expect, test } from "vitest";
import { PositionManager } from "../src/position/PositionManager.js";
import { createPosition } from "../src/position/PositionState.js";

describe("PositionManager", () => {
  test("partial sells are percentages of the current remaining position", () => {
    const manager = new PositionManager();
    manager.upsert(createPosition({
      mint: "m",
      decimals: 6,
      walletAddress: "w",
      amount: 100,
      entryPrice: 1
    }));

    manager.applyFill("m", 50, 40, "sig-1");
    expect(manager.get("m")?.remainingPercentage).toBe(50);
    expect(manager.get("m")?.sellState).toBe("PARTIALLY_SOLD");

    manager.applyFill("m", 50, 20, "sig-2");
    expect(manager.get("m")?.remainingPercentage).toBe(25);
    expect(manager.get("m")?.sellState).toBe("PARTIALLY_SOLD");
  });

  test("a 100% sell consumes all remaining balance", () => {
    const manager = new PositionManager();
    manager.upsert(createPosition({
      mint: "m",
      decimals: 6,
      walletAddress: "w",
      amount: 100,
      entryPrice: 1
    }));

    manager.applyFill("m", 50, 40, "sig-1");
    manager.applyFill("m", 100, 50, "sig-2");

    expect(manager.get("m")?.remainingPercentage).toBe(0);
    expect(manager.get("m")?.sellState).toBe("SOLD");
  });
});
