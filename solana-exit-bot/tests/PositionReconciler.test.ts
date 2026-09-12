import { describe, expect, test, vi } from "vitest";
import { PositionReconciler } from "../src/position/PositionReconciler.js";
import { Position } from "../src/types.js";

const makePosition = (remainingPercentage = 100): Position => ({
  mint: "So11111111111111111111111111111111111111112",
  decimals: 6,
  walletAddress: "11111111111111111111111111111111",
  amount: 1_000,
  amountRaw: 1_000_000n,
  entryPrice: 1,
  entryValue: 1_000,
  entryTimestamp: Date.now(),
  currentPrice: 1,
  highestPrice: 1,
  lowestPrice: 1,
  realizedPnL: 0,
  unrealizedPnL: 0,
  remainingPercentage,
  sellState: "UNKNOWN",
  completedTakeProfitLevels: new Set()
});

const fakeRpc = (observedRaw: bigint, shouldFail = false) => {
  const connection = {
    getParsedTokenAccountsByOwner: vi.fn(async () => {
      if (shouldFail) throw new Error("RPC timeout");
      return {
        value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: observedRaw.toString() } } } } } }]
      };
    })
  };
  return {
    getEndpointsInPriorityOrder: () => ["http://rpc"],
    getActiveEndpoint: () => "http://rpc",
    getConnection: () => connection,
    recordHealthCheck: vi.fn(async () => undefined)
  } as never;
};

describe("PositionReconciler", () => {
  test("marks a position SOLD when the exact expected token amount disappeared", async () => {
    const position = makePosition();
    const result = await new PositionReconciler(fakeRpc(0)).reconcile(position, 1_000_000n, "sig");
    expect(result).toBe("SOLD");
    expect(position.remainingPercentage).toBe(0);
    expect(position.sellState).toBe("SOLD");
    expect(position.sellSignature).toBe("sig");
  });

  test("marks a position PARTIALLY_SOLD when the exact expected amount was reduced", async () => {
    const position = makePosition();
    const result = await new PositionReconciler(fakeRpc(400_000n)).reconcile(position, 600_000n, "sig");
    expect(result).toBe("PARTIALLY_SOLD");
    expect(position.remainingPercentage).toBe(40);
    expect(position.sellState).toBe("PARTIALLY_SOLD");
  });

  test("keeps UNKNOWN when the observed balance does not match the expected sell", async () => {
    const position = makePosition();
    const result = await new PositionReconciler(fakeRpc(300_000n)).reconcile(position, 600_000n, "sig");
    expect(result).toBe("AMBIGUOUS");
    expect(position.sellState).toBe("UNKNOWN");
    expect(position.remainingPercentage).toBe(100);
  });

  test("returns UNAVAILABLE when the RPC cannot read token balance", async () => {
    const position = makePosition();
    const result = await new PositionReconciler(fakeRpc(0n, true)).reconcile(position, 1_000_000n, "sig");
    expect(result).toBe("UNAVAILABLE");
    expect(position.sellState).toBe("UNKNOWN");
  });

  test("fails over to a second RPC endpoint after the first balance lookup times out", async () => {
    const position = makePosition();
    let firstCalls = 0;
    let secondCalls = 0;
    const first = { getParsedTokenAccountsByOwner: vi.fn(async () => { firstCalls += 1; throw new Error("ETIMEDOUT"); }) };
    const second = { getParsedTokenAccountsByOwner: vi.fn(async () => { secondCalls += 1; return { value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: "0" } } } } } }] }; }) };
    const manager = {
      getEndpointsInPriorityOrder: () => ["http://rpc-a", "http://rpc-b"],
      getActiveEndpoint: () => "http://rpc-a",
      getConnection: (endpoint: string) => endpoint === "http://rpc-a" ? first : second,
      recordHealthCheck: vi.fn(async () => undefined)
    };
    const result = await new PositionReconciler(manager as never).reconcile(position, 1_000_000n, "sig-failover");
    expect(result).toBe("SOLD");
    expect(firstCalls).toBe(1);
    expect(secondCalls).toBe(1);
    expect(position.sellSignature).toBe("sig-failover");
  });

  test("returns UNAVAILABLE and preserves UNKNOWN when every RPC endpoint fails", async () => {
    const position = makePosition();
    const manager = {
      getEndpointsInPriorityOrder: () => ["http://rpc-a", "http://rpc-b"],
      getActiveEndpoint: () => "http://rpc-a",
      getConnection: () => ({ getParsedTokenAccountsByOwner: vi.fn(async () => { throw new Error("HTTP 503 Service Unavailable"); }) }),
      recordHealthCheck: vi.fn(async () => undefined)
    };
    const result = await new PositionReconciler(manager as never).reconcile(position, 1_000_000n, "sig-unavailable");
    expect(result).toBe("UNAVAILABLE");
    expect(position.sellState).toBe("UNKNOWN");
    expect(position.remainingPercentage).toBe(100);
  });
});
