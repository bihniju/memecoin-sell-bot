import { ComputeBudgetProgram, Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { describe, expect, test } from "vitest";
import { SolanaTransactionTransport, TransactionSubmissionUncertainError } from "../src/execution/TransactionTransport.js";

const built = {
  serialized: new Uint8Array([1, 2, 3]),
  priorityFeeMicrolamports: 1000,
  minOutAmount: 1n
};

function managerFor(connection: any, endpoints = ["http://a"]) {
  const connections = new Map(endpoints.map((endpoint) => [endpoint, connection]));
  return {
    getActiveEndpoint: () => endpoints[0],
    getActiveConnection: () => connection,
    getEndpointsInPriorityOrder: () => endpoints,
    getConnection: (endpoint: string) => connections.get(endpoint) ?? connection,
    reportEndpointFailure: () => {},
    recordHealthCheck: async () => {}
  };
}

function signedBuilt() {
  const payer = Keypair.generate();
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })]
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([payer]);
  return {
    serialized: transaction.serialize(),
    transaction,
    priorityFeeMicrolamports: 1000,
    minOutAmount: 1n,
    recentBlockhash: message.recentBlockhash,
    lastValidBlockHeight: 100
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

  test("reconciles a network timeout when the original transaction actually landed", async () => {
    let sends = 0;
    const transaction = signedBuilt();
    const connection = {
      rpcEndpoint: "http://a",
      async sendRawTransaction() {
        sends += 1;
        throw new Error("network timeout after RPC accepted transaction");
      },
      async getSignatureStatus() {
        return { value: { err: null, confirmationStatus: "confirmed" } };
      },
      async getBlockHeight() { return 50; }
    };
    const transport = new SolanaTransactionTransport(managerFor(connection) as never, {
      skipPreflight: false, maxRetries: 2, confirmationTimeoutMs: 25
    });

    const sent = await transport.send(transaction);
    expect(sent.duplicate).toBe(false);
    expect(sent.signature).toHaveLength(88);
    expect(sends).toBe(1);
  });

  test("does not fail over or blindly resend when a timed-out submission remains unknown", async () => {
    let sendsA = 0;
    let sendsB = 0;
    const transaction = signedBuilt();
    const connectionA = {
      rpcEndpoint: "http://a",
      async sendRawTransaction() {
        sendsA += 1;
        throw new Error("ETIMEDOUT network timeout");
      },
      async getSignatureStatus() { return { value: null }; },
      async getBlockHeight() { return 50; }
    };
    const connectionB = {
      rpcEndpoint: "http://b",
      async sendRawTransaction() {
        sendsB += 1;
        return "sig-should-not-send";
      },
      async getSignatureStatus() { return { value: null }; },
      async getBlockHeight() { return 50; }
    };
    const manager = {
      getActiveEndpoint: () => "http://a",
      getActiveConnection: () => connectionA,
      getEndpointsInPriorityOrder: () => ["http://a", "http://b"],
      getConnection: (endpoint: string) => endpoint === "http://a" ? connectionA : connectionB,
      recordHealthCheck: async () => {}
    };
    const transport = new SolanaTransactionTransport(manager as never, {
      skipPreflight: false, maxRetries: 2, confirmationTimeoutMs: 10
    });

    await expect(transport.send(transaction)).rejects.toBeInstanceOf(TransactionSubmissionUncertainError);
    expect(sendsA).toBe(1);
    expect(sendsB).toBe(0);
  });
});
