import { describe, expect, test, vi, afterEach } from "vitest";
import { JupiterQuoteProvider } from "../src/execution/QuoteProvider.js";
import { createPosition } from "../src/position/PositionState.js";
import { RpcManager } from "../src/rpc/RpcManager.js";
import { Logger } from "../src/logging/Logger.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

describe("exit resilience", () => {
  test("uses exact raw token amount for Jupiter quote", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      inAmount: "123456789012345678",
      outAmount: "1000",
      priceImpactPct: "0.1",
      routePlan: [{ swapInfo: {} }]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new JupiterQuoteProvider("https://quote.test", undefined, { timeoutMs: 500, retries: 0, cacheMs: 0 });
    const position = createPosition({ mint: "TOKEN", decimals: 9, walletAddress: "wallet", amount: 123.456, amountRaw: 123456789n, entryPrice: 1 });
    await provider.quoteForPosition(position, "SOL", 50, 250);

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("amount=61728394");
  });

  test("retries transient Jupiter failures", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ inAmount: "10", outAmount: "9", priceImpactPct: "0", routePlan: [{}] }), { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new JupiterQuoteProvider("https://quote.test", undefined, { timeoutMs: 500, retries: 1, cacheMs: 0 });
    const quote = await provider.getQuote({ inputMint: "TOKEN", outputMint: "SOL", amount: 10n, slippageBps: 100 });
    expect(quote.expectedOutAmount).toBe(9n);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("RPC manager prefers healthy low-latency endpoint after a failure", async () => {
    const logger = new Logger("error");
    const rpc = new RpcManager(["https://rpc-a.test", "https://rpc-b.test"], logger);
    await rpc.recordHealthCheck("https://rpc-a.test", 900, true);
    await rpc.recordHealthCheck("https://rpc-b.test", 40, true);
    expect(rpc.getEndpointsInPriorityOrder()[0]).toBe("https://rpc-b.test");
    rpc.reportEndpointFailure("https://rpc-b.test");
    expect(rpc.getEndpointsInPriorityOrder()[0]).toBe("https://rpc-a.test");
  });
});
