import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { loadConfig } from "../src/config.js";

const dryRunSource = readFileSync(resolve(process.cwd(), "src/dryRun.ts"), "utf8");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("real dry-run safety", () => {
  test("does not contain a raw transaction broadcast call", () => {
    expect(dryRunSource).not.toContain("sendRawTransaction");
  });

  test("requires dry-run mode and disables live trading in CI configuration", () => {
    vi.stubEnv("MODE", "dry-run");
    vi.stubEnv("DRY_RUN", "true");
    vi.stubEnv("LIVE_TRADING_ENABLED", "false");

    const config = loadConfig();
    expect(config.mode).toBe("dry-run");
    expect(config.dryRun).toBe(true);
    expect(config.wallet.liveTradingEnabled).toBe(false);
  });

  test("never treats an unset live-trading flag as enabled", () => {
    vi.stubEnv("MODE", "dry-run");
    vi.stubEnv("DRY_RUN", "true");
    delete process.env.LIVE_TRADING_ENABLED;

    const config = loadConfig();
    expect(config.wallet.liveTradingEnabled).toBe(false);
  });

  test("live-trading configuration is observable and can be rejected by the dry-run gate", () => {
    vi.stubEnv("MODE", "dry-run");
    vi.stubEnv("DRY_RUN", "true");
    vi.stubEnv("LIVE_TRADING_ENABLED", "true");

    const config = loadConfig();
    expect(config.wallet.liveTradingEnabled).toBe(true);
    expect(dryRunSource).toContain("Real dry-run refuses LIVE_TRADING_ENABLED=true");
  });
});
