import { describe, expect, test } from "vitest";
import { SolanaTransactionTransport } from "../src/execution/TransactionTransport.js";
import type { BuiltTransaction } from "../src/types.js";

const built: BuiltTransaction = {
  serialized: new Uint8Array([1, 2, 3]),
  priorityFeeMicrolamports: 0,
  minOutAmount: 1n,
  lastValidBlockHeight: 100
};

describe("RPC read boundedness", () => {
  test("slow block-height RPC cannot block the pre-broadcast check indefinitely", async () => {
    const slow = {
      rpcEndpoint: "http://slow",
      async getBlockHeight() { return await new Promise<number>(() => {}); },
      async sendRawTransaction() { return "sig-slow"; }
    };
    const healthy = {
      rpcEndpoint: "http://healthy",
      async getBlockHeight() { return 90; },
      async sendRawTransaction() { return "sig-healthy"; }
    };

    const manager = {
      getActiveEndpoint: () => "http://slow",
      getEndpointsInPriorityOrder: () => ["http://slow", "http://healthy"],
      getConnection: (endpoint: string) => endpoint === "http://slow" ? slow : healthy,
      recordHealthCheck: async () => {}
    };

    const transport = new SolanaTransactionTransport(manager as never, {
      skipPreflight: false,
      maxRetries: 0,
      confirmationTimeoutMs: 25,
      rpcReadTimeoutMs: 10,
      sendTimeoutMs: 10
    });

    const started = performance.now();
    const sent = await transport.send(built);
    const elapsed = performance.now() - started;

    expect(sent.signature).toBe("sig-slow");
    expect(elapsed).toBeLessThan(100);
  });
});
