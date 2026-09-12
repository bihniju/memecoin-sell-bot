import { describe, expect, test } from "vitest";
import { SolanaTransactionTransport } from "../src/execution/TransactionTransport.js";
import { ExecutionAttemptTracker } from "../src/execution/ExecutionAttempt.js";

function managerFor(connection: any) {
  return {
    getActiveEndpoint: () => "http://a",
    getEndpointsInPriorityOrder: () => ["http://a"],
    getConnection: () => connection,
    recordHealthCheck: async () => {}
  };
}

const baseTx = {
  serialized: new Uint8Array([1, 2, 3]),
  priorityFeeMicrolamports: 1000,
  minOutAmount: 1n
};

describe("blockhash expiry and execution attempts", () => {
  test("refuses to broadcast an already expired transaction", async () => {
    let sends = 0;
    const connection = {
      rpcEndpoint: "http://a",
      async getBlockHeight() { return 101; },
      async sendRawTransaction() { sends += 1; return "sig-expired"; }
    };
    const transport = new SolanaTransactionTransport(managerFor(connection) as never, {
      skipPreflight: false, maxRetries: 2, confirmationTimeoutMs: 50
    });

    await expect(transport.send({ ...baseTx, lastValidBlockHeight: 100, recentBlockhash: "hash-a" })).rejects.toThrow(/expired before broadcast/);
    expect(sends).toBe(0);
  });

  test("rechecks signature after expiry and accepts a transaction that landed", async () => {
    let blockHeight = 50;
    let statusChecks = 0;
    const connection = {
      rpcEndpoint: "http://a",
      async sendRawTransaction() { return "sig-landed"; },
      async getSignatureStatus() {
        statusChecks += 1;
        if (statusChecks === 1) return { value: null };
        return { value: { err: null, confirmationStatus: "confirmed" } };
      },
      async getBlockHeight() { return blockHeight; }
    };
    const transport = new SolanaTransactionTransport(managerFor(connection) as never, {
      skipPreflight: false, maxRetries: 2, confirmationTimeoutMs: 100
    });
    const tx = { ...baseTx, lastValidBlockHeight: 100, recentBlockhash: "hash-a" };
    const sent = await transport.send(tx);

    blockHeight = 999;
    expect(await transport.confirm(sent.signature, tx)).toBe("confirmed");
    expect(statusChecks).toBe(2);
  });

  test("returns finalized when the transaction reaches finalized commitment", async () => {
    const connection = {
      rpcEndpoint: "http://a",
      async sendRawTransaction() { return "sig-finalized"; },
      async getSignatureStatus() { return { value: { err: null, confirmationStatus: "finalized" } }; }
    };
    const transport = new SolanaTransactionTransport(managerFor(connection) as never, {
      skipPreflight: false, maxRetries: 2, confirmationTimeoutMs: 100
    });
    const sent = await transport.send(baseTx);
    expect(await transport.confirm(sent.signature)).toBe("finalized");
  });

  test("returns expired only when the transaction is absent after blockhash expiry", async () => {
    const connection = {
      rpcEndpoint: "http://a",
      async sendRawTransaction() { return "sig-never-landed"; },
      async getSignatureStatus() { return { value: null }; },
      async getBlockHeight() { return 101; }
    };
    const transport = new SolanaTransactionTransport(managerFor(connection) as never, {
      skipPreflight: false, maxRetries: 2, confirmationTimeoutMs: 100
    });
    const tx = { ...baseTx, lastValidBlockHeight: 200, recentBlockhash: "hash-a" };
    const sent = await transport.send(tx);
    const expiredTx = { ...tx, lastValidBlockHeight: 100 };
    expect(await transport.confirm(sent.signature, expiredTx)).toBe("expired");
  });

  test("tracks rebuild count and expiry state", () => {
    const tracker = new ExecutionAttemptTracker({ executionId: "exec-1", positionId: "mint-1", trigger: "EMERGENCY" });
    tracker.setTransaction({ transactionHash: "tx-1", recentBlockhash: "hash-1", lastValidBlockHeight: 100, quoteId: "quote-1" });
    tracker.markBuilt(1);
    tracker.markSigned(2);
    tracker.markExpired(3);
    tracker.markRebuilt();

    expect(tracker.attempt.status).toBe("REBUILT");
    expect(tracker.attempt.expiryDetectedAt).toBe(3);
    expect(tracker.attempt.rebuildCount).toBe(1);
    expect(tracker.attempt.lastValidBlockHeight).toBe(100);
  });

  test("records failed attempts without populating confirmedAt", () => {
    const tracker = new ExecutionAttemptTracker({ executionId: "exec-2", positionId: "mint-2", trigger: "HARD_STOP_LOSS" });
    tracker.markFailed(42);
    expect(tracker.attempt.status).toBe("FAILED");
    expect(tracker.attempt.failedAt).toBe(42);
    expect(tracker.attempt.confirmedAt).toBeUndefined();
  });
});
