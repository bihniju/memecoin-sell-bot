import { describe, expect, test } from "vitest";
import { SolanaTransactionTransport } from "../src/execution/TransactionTransport.js";

const built = {
  serialized: new Uint8Array([1, 2, 3]),
  priorityFeeMicrolamports: 1000,
  minOutAmount: 1n
};

function managerFor(connection: any) {
  return {
    getActiveEndpoint: () => "http://a",
    getActiveConnection: () => connection,
    getEndpointsInPriorityOrder: () => ["http://a"],
    getConnection: () => connection,
    reportEndpointFailure: () => {},
    recordHealthCheck: async () => {}
  };
}

describe("TransactionTransport", () => {
  test("confirms submitted transaction", async () => {
    const connection = {
      rpcEndpoint: "http://a",
      async sendRawTransaction() { return "sig-1"; },
      async getSignatureStatus() { return { value: { err: null, confirmationStatus: "confirmed" } }; }
    };
    const transport = new SolanaTransactionTransport(managerFor(connection) as never, {
      skipPreflight: false, maxRetries: 2, confirmationTimeoutMs: 200
    });
    const sent = await transport.send(built);
    const status = await transport.confirm(sent.signature);
    expect(sent.signature).toBe("sig-1");
    expect(status).toBe("confirmed");
  });

  test("returns unknown when confirmation not found in timeout", async () => {
    const connection = {
      rpcEndpoint: "http://a",
      async sendRawTransaction() { return "sig-2"; },
      async getSignatureStatus() { return { value: null }; }
    };
    const transport = new SolanaTransactionTransport(managerFor(connection) as never, {
      skipPreflight: false, maxRetries: 2, confirmationTimeoutMs: 10
    });
    const sent = await transport.send(built);
    expect(await transport.confirm(sent.signature)).toBe("unknown");
  });

  test("prevents duplicate send for same serialized transaction", async () => {
    let sends = 0;
    const connection = {
      rpcEndpoint: "http://a",
      async sendRawTransaction() { sends += 1; return "sig-3"; },
      async getSignatureStatus() { return { value: { err: null, confirmationStatus: "confirmed" } }; }
    };
    const transport = new SolanaTransactionTransport(managerFor(connection) as never, {
      skipPreflight: false, maxRetries: 2, confirmationTimeoutMs: 50
    });
    const first = await transport.send(built);
    const second = await transport.send(built);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(sends).toBe(1);
  });
});
