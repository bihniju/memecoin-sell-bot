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

const signatureStatus = (status: "confirmed" | "failed" | "unknown" | "throw" = "confirmed") => vi.fn(async () => {
  if (status === "throw") throw new Error("signature RPC timeout");
  if (status === "failed") return { value: { err: { custom: 1 }, confirmationStatus: "confirmed" } };
  if (status === "unknown") return { value: null };
  return { value: { err: null, confirmationStatus: "confirmed" } };
});

const fakeRpc = (
  observedRaw: bigint,
  options: { rpcFail?: boolean; signatureStatus?: "confirmed" | "failed" | "unknown" | "throw" } = {}
) => {
  const connection = {
    getSignatureStatus: signatureStatus(options.signatureStatus),
    getParsedTokenAccountsByOwner: vi.fn(async () => {
      if (options.rpcFail) throw new Error("RPC timeout");
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
  test("marks a position SOLD when the signature is confirmed and the expected token amount disappeared", async () => {
    const position = makePosition();
    const result = await new PositionReconciler(fakeRpc(0)).reconcile(position, 1_000_000n, "sig");
    expect(result).toBe("SOLD");
    expect(position.remainingPercentage).toBe(0);
    expect(position.sellState).toBe("SOLD");
    expect(position.sellSignature).toBe("sig");
  });

  test("marks a position PARTIALLY_SOLD when the confirmed signature matches the expected balance reduction", async () => {
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

  test("does not mark SOLD when the submitted signature is known to have failed", async () => {
    const position = makePosition();
    const result = await new PositionReconciler(fakeRpc(0n, { signatureStatus: "failed" })).reconcile(position, 1_000_000n, "sig");
    expect(result).toBe("UNCHANGED");
    expect(position.sellState).toBe("UNKNOWN");
    expect(position.remainingPercentage).toBe(100);
  });

  test("does not infer a sell from balance alone while the signature remains unknown", async () => {
    const position = makePosition();
    const result = await new PositionReconciler(fakeRpc(0n, { signatureStatus: "unknown" })).reconcile(position, 1_000_000n, "sig");
    expect(result).toBe("UNAVAILABLE");
    expect(position.sellState).toBe("UNKNOWN");
    expect(position.remainingPercentage).toBe(100);
  });

  test("returns UNAVAILABLE when the RPC cannot read token balance", async () => {
    const position = makePosition();
    const result = await new PositionReconciler(fakeRpc(0n, { rpcFail: true })).reconcile(position, 1_000_000n, "sig");
    expect(result).toBe("UNAVAILABLE");
    expect(position.sellState).toBe("UNKNOWN");
  });

  test("returns UNAVAILABLE when signature lookup itself is unavailable", async () => {
    const position = makePosition();
    const result = await new PositionReconciler(fakeRpc(0n, { signatureStatus: "throw" })).reconcile(position, 1_000_000n, "sig");
    expect(result).toBe("UNAVAILABLE");
    expect(position.sellState).toBe("UNKNOWN");
  });

  test("fails over to a second RPC endpoint after the first signature lookup fails", async () => {
    const position = makePosition();
    let firstCalls = 0;
    let secondCalls = 0;
    const first = {
      getSignatureStatus: signatureStatus("throw"),
      getParsedTokenAccountsByOwner: vi.fn(async () => { firstCalls += 1; throw new Error("ETIMEDOUT"); })
    };
    const second = {
      getSignatureStatus: signatureStatus("confirmed"),
      getParsedTokenAccountsByOwner: vi.fn(async () => {
        secondCalls += 1;
        return { value: [{ account: { data: { parsed: { info: { tokenAmount: { amount: "0" } } } } } }] };
      })
    };
    const manager = {
      getEndpointsInPriorityOrder: () => ["http://rpc-a", "http://rpc-b"],
      getActiveEndpoint: () => "http://rpc-a",
      getConnection: (endpoint: string) => endpoint === "http://rpc-a" ? first : second,
      recordHealthCheck: vi.fn(async () => undefined)
    };
    const result = await new PositionReconciler(manager as never).reconcile(position, 1_000_000n, "sig-failover");
    expect(result).toBe("SOLD");
    expect(firstCalls).toBe(0);
    expect(secondCalls).toBe(1);
    expect(position.sellSignature).toBe("sig-failover");
  });
});
