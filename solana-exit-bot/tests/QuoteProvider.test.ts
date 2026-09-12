import { afterEach, describe, expect, test, vi } from "vitest";
import { JupiterQuoteProvider } from "../src/execution/QuoteProvider.js";
import { Position } from "../src/types.js";

const position: Position = {
  mint: "TokenMint1111111111111111111111111111111111111",
  decimals: 6,
  amount: 10,
  amountRaw: 10_000_000n,
  entryPrice: 1,
  currentPrice: 1,
  remainingPercentage: 100,
  createdAt: Date.now()
};

const response = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("JupiterQuoteProvider failure handling", () => {
  test("retries 429 responses and succeeds on a later attempt", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? response(429, { error: "rate limited" })
        : response(200, { inAmount: "10000000", outAmount: "9000000", routePlan: [{}], priceImpactPct: "0.5" });
    }));

    const provider = new JupiterQuoteProvider("https://quote.test", undefined, { retries: 1, timeoutMs: 250, cacheMs: 0 });
    const quote = await provider.getQuote({ inputMint: position.mint, outputMint: "So11111111111111111111111111111111111111112", amount: 10_000_000n, slippageBps: 250 });

    expect(calls).toBe(2);
    expect(quote.routeAvailable).toBe(true);
    expect(quote.expectedOutAmount).toBe(9_000_000n);
  });

  test("retries 5xx responses and surfaces failure after retries are exhausted", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      return response(503, { error: "unavailable" });
    }));

    const provider = new JupiterQuoteProvider("https://quote.test", undefined, { retries: 1, timeoutMs: 250, cacheMs: 0 });
    await expect(provider.getQuote({ inputMint: position.mint, outputMint: "So11111111111111111111111111111111111111112", amount: 10_000_000n, slippageBps: 250 })).rejects.toThrow(/Jupiter quote transient failure: 503/);
    expect(calls).toBe(2);
  });

  test("does not retry permanent 400 errors", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls += 1;
      return response(400, { error: "NO_ROUTES_FOUND" });
    }));

    const provider = new JupiterQuoteProvider("https://quote.test", undefined, { retries: 3, timeoutMs: 250, cacheMs: 0 });
    await expect(provider.getQuote({ inputMint: position.mint, outputMint: "So11111111111111111111111111111111111111112", amount: 10_000_000n, slippageBps: 250 })).rejects.toThrow(/Jupiter quote failed: 400/);
    expect(calls).toBe(1);
  });

  test("retries an aborted request and then succeeds", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: string, options: { signal?: AbortSignal }) => {
      calls += 1;
      if (calls === 1) {
        options.signal?.dispatchEvent(new Event("abort"));
        throw new Error("The operation was aborted");
      }
      return response(200, { inAmount: "10000000", outAmount: "9500000", routePlan: [{}], priceImpactPct: "0.2" });
    }));

    const provider = new JupiterQuoteProvider("https://quote.test", undefined, { retries: 1, timeoutMs: 250, cacheMs: 0 });
    const quote = await provider.getQuote({ inputMint: position.mint, outputMint: "So11111111111111111111111111111111111111112", amount: 10_000_000n, slippageBps: 250 });

    expect(calls).toBe(2);
    expect(quote.expectedOutAmount).toBe(9_500_000n);
  });

  test("marks a successful response with no route as unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(200, { inAmount: "10000000", outAmount: "0", routePlan: [], priceImpactPct: "0" })));

    const provider = new JupiterQuoteProvider("https://quote.test", undefined, { retries: 0, timeoutMs: 250, cacheMs: 0 });
    const quote = await provider.getQuote({ inputMint: position.mint, outputMint: "So11111111111111111111111111111111111111112", amount: 10_000_000n, slippageBps: 250 });

    expect(quote.routeAvailable).toBe(false);
    expect(quote.expectedOutAmount).toBe(0n);
  });
});
