import { describe, expect, test } from "vitest";
import { PriceMonitor } from "../src/market/PriceMonitor.js";

describe("Market monitor", () => {
  test("stale market data detection", () => {
    const monitor = new PriceMonitor();
    monitor.ingest({ mint: "m", price: 1, timestamp: Date.now() - 2000 });
    expect(monitor.isStale("m", 1000)).toBe(true);
  });
});
