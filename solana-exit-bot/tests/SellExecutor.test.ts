import { describe, expect, test } from "vitest";
import { loadConfig } from "../src/config.js";
import { SellExecutor, TransactionTransport } from "../src/execution/SellExecutor.js";
import { PriorityFeeManager } from "../src/execution/PriorityFeeManager.js";
import { StaticQuoteProvider } from "../src/execution/QuoteProvider.js";
import { RetryManager } from "../src/execution/RetryManager.js";
import { TransactionBuilder } from "../src/execution/TransactionBuilder.js";
import { Logger } from "../src/logging/Logger.js";
import { PositionManager } from "../src/position/PositionManager.js";
import { createPosition } from "../src/position/PositionState.js";
import { TriggerDecision } from "../src/types.js";

class TestTransport implements TransactionTransport {
  submits = 0;
  async submit() {
    this.submits += 1;
    return { signature: `sig-${this.submits}` };
  }
  async confirm() {
    return true;
  }
}

describe("SellExecutor", () => {
  test("prevents duplicate sell for same position while active", async () => {
    process.env.MODE = "dry-run";
    process.env.DRY_RUN = "true";
    const config = loadConfig();
    const pm = new PositionManager();
    pm.upsert(createPosition({ mint: "m", decimals: 6, walletAddress: "w", amount: 100, entryPrice: 1 }));

    const transport = new TestTransport();
    const executor = new SellExecutor(
      config,
      pm,
      new StaticQuoteProvider(),
      new TransactionBuilder(),
      new RetryManager(config.execution),
      new PriorityFeeManager(config.execution),
      transport,
      new Logger("error")
    );

    const decision: TriggerDecision = {
      trigger: "RAPID_DECLINE",
      reason: "risk",
      timestamp: Date.now(),
      price: 0.9,
      entryPrice: 1,
      pnlPct: -10,
      riskScore: 90,
      sellPct: 100
    };

    executor.enqueue(decision, "m");
    executor.enqueue(decision, "m");

    await new Promise((r) => setTimeout(r, 30));

    const p = pm.get("m");
    expect(p?.sellState).toBe("SOLD");
    expect(transport.submits).toBe(0);
  });

  test("take profit level is consumed only once", () => {
    const p = createPosition({ mint: "m", decimals: 6, walletAddress: "w", amount: 100, entryPrice: 1 });
    p.currentPrice = 1.5;
    p.completedTakeProfitLevels.add("tp1");
    expect(p.completedTakeProfitLevels.has("tp1")).toBe(true);
    expect(p.completedTakeProfitLevels.size).toBe(1);
  });
});
