import { describe, expect, test } from "vitest";
import { SolanaTransactionTransport } from "../../src/execution/TransactionTransport.js";

const built = {
  serialized: new Uint8Array([7, 8, 9]),
  priorityFeeMicrolamports: 50_000,
  minOutAmount: 1n
};

function managerFor(connections: Record<string, any>, endpoints = Object.keys(connections)) {
  let active = endpoints[0];
  return {
    getActiveEndpoint: () => active,
    getActiveConnection: () => connections[active],
    getEndpointsInPriorityOrder: () => endpoints,
    getConnection: (endpoint: string) => connections[endpoint],
    reportEndpointFailure: (endpoint: string) => { if (endpoint === active) active = endpoints.find((item) => item !== endpoint) ?? endpoint; },
    recordHealthCheck: async () => {}
  };
}

describe("transaction chaos", () => {
  test("fails over to a second RPC when the first broadcast fails", async () => {
    let firstAttempts = 0;
    let secondAttempts = 0;
    const connections = {
      "http://a": {
        rpcEndpoint: "http://a",
        async sendRawTransaction() { firstAttempts += 1; throw new Error("RPC unavailable"); }
      },
      "http://b": {
        rpcEndpoint: "http://b",
        async sendRawTransaction() { secondAttempts += 1; return "sig-b"; }
      }
    };
    const transport = new SolanaTransactionTransport(managerFor(connections) as never, {
      skipPreflight: true,
      maxRetries: 0,
      confirmationTimeoutMs: 50
    });

    const sent = await transport.send(built);
    expect(sent.signature).toBe("sig-b");
    expect(firstAttempts).toBe(1);
    expect(secondAttempts).toBe(1);
  });

  test("never blindly resends an already broadcast transaction after unknown confirmation", async () => {
    let sends = 0;
    const connection = {
      rpcEndpoint: "http://a",
      async sendRawTransaction() { sends += 1; return "sig-unknown"; },
      async getSignatureStatus() { return { value: null }; }
    };
    const transport = new SolanaTransactionTransport(managerFor({ "http://a": connection }) as never, {
      skipPreflight: true,
      maxRetries: 3,
      confirmationTimeoutMs: 5
    });

    const sent = await transport.send(built);
    expect(await transport.confirm(sent.signature)).toBe("unknown");
    expect(sends).toBe(1);
  });

  test("deduplicates identical serialized transactions even under repeated sends", async () => {
    let sends = 0;
    const connection = {
      rpcEndpoint: "http://a",
      async sendRawTransaction() { sends += 1; return `sig-${sends}`; }
    };
    const transport = new SolanaTransactionTransport(managerFor({ "http://a": connection }) as never, {
      skipPreflight: true,
      maxRetries: 1,
      confirmationTimeoutMs: 20
    });

    const first = await transport.send(built);
    const second = await transport.send(built);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.signature).toBe(first.signature);
    expect(sends).toBe(1);
  });

  test("surfaces an RPC failure when every endpoint rejects the broadcast", async () => {
    const connections = {
      "http://a": { rpcEndpoint: "http://a", async sendRawTransaction() { throw new Error("down-a"); } },
      "http://b": { rpcEndpoint: "http://b", async sendRawTransaction() { throw new Error("down-b"); } }
    };
    const transport = new SolanaTransactionTransport(managerFor(connections) as never, {
      skipPreflight: true,
      maxRetries: 0,
      confirmationTimeoutMs: 20
    });

    await expect(transport.send(built)).rejects.toThrow();
  });
});
