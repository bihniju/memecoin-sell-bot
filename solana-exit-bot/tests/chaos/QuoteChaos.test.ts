import { afterEach, describe, expect, test, vi } from "vitest";
import { JupiterQuoteProvider } from "../../src/execution/QuoteProvider.js";
import { createPosition } from "../../src/position/PositionState.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("quote chaos", () => {
  test("retries 429/5xx but does not retry permanent 4xx", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ outAmount: "99", routePlan: [{}], priceImpactPct: "0.2" }), { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new JupiterQuoteProvider("https://quote.test", undefined, { retries: 2, cacheMs: 0 });
    const quote = await provider.getQuote({ inputMint: "TOKEN", outputMint: "SOL", amount: 100n, slippageBps: 100 });
    expect(quote.expectedOutAmount).toBe(99n);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("bad request", { status: 400 }));
    await expect(provider.getQuote({ inputMint: "TOKEN2", outputMint: "SOL", amount: 100n, slippageBps: 100 })).rejects.toThrow("400");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("preserves no-route result when both normal and direct routes disappear", async () => {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ outAmount: "0", routePlan: [], priceImpactPct: "100" }), { status: 200 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new JupiterQuoteProvider("https://quote.test", undefined, { retries: 0, cacheMs: 0 });
    const position = createPosition({
      mint: "TOKEN",
      decimals: 9,
      walletAddress: "wallet",
      amount: 10,
      amountRaw: 10_000_000_000n,
      entryPrice: 1
    });
    const quote = await provider.quoteForPosition(position, "SOL", 100, 250);

    expect(quote.routeAvailable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calls[1]).toContain("onlyDirectRoutes=true");
  });

  test("accepts a direct route after the primary route vanishes", async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      const body = call === 1
        ? { outAmount: "0", routePlan: [], priceImpactPct: "50" }
        : { outAmount: "80", routePlan: [{}], priceImpactPct: "1" };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const provider = new JupiterQuoteProvider("https://quote.test", undefined, { retries: 0, cacheMs: 0 });
    const position = createPosition({ mint: "TOKEN", decimals: 6, walletAddress: "wallet", amount: 100, amountRaw: 100_000_000n, entryPrice: 1 });
    const quote = await provider.quoteForPosition(position, "SOL", 100, 250);

    expect(quote.routeAvailable).toBe(true);
    expect(quote.expectedOutAmount).toBe(80n);
  });

  test("rejects zero and negative quote amounts before network access", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    const provider = new JupiterQuoteProvider("https://quote.test", undefined, { retries: 0 });

    await expect(provider.getQuote({ inputMint: "TOKEN", outputMint: "SOL", amount: 0n, slippageBps: 100 })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
