import { Connection, SendOptions } from "@solana/web3.js";
import { BuiltTransaction, ConfirmationStatus } from "../types.js";
import { RpcManager } from "../rpc/RpcManager.js";

export interface TransactionTransport {
  send(transaction: BuiltTransaction): Promise<{ signature: string; endpoint: string; duplicate: boolean }>;
  confirm(signature: string): Promise<ConfirmationStatus>;
}

export class SolanaTransactionTransport implements TransactionTransport {
  private readonly sentByHash = new Map<string, string>();

  constructor(
    private readonly rpcManager: RpcManager,
    private readonly options: { skipPreflight: boolean; maxRetries: number; confirmationTimeoutMs: number }
  ) {}

  async send(transaction: BuiltTransaction): Promise<{ signature: string; endpoint: string; duplicate: boolean }> {
    const txHash = Buffer.from(transaction.serialized).toString("base64");
    const existing = this.sentByHash.get(txHash);
    if (existing) {
      return { signature: existing, endpoint: this.rpcManager.getActiveEndpoint(), duplicate: true };
    }

    const endpoint = this.rpcManager.getActiveEndpoint();
    const connection = this.rpcManager.getActiveConnection();
    const signature = await connection.sendRawTransaction(transaction.serialized, {
      skipPreflight: this.options.skipPreflight,
      maxRetries: this.options.maxRetries
    } satisfies SendOptions);
    this.sentByHash.set(txHash, signature);

    return { signature, endpoint, duplicate: false };
  }

  async confirm(signature: string): Promise<ConfirmationStatus> {
    const start = Date.now();
    const endpoints = this.rpcManager.getEndpointsInPriorityOrder();

    while (Date.now() - start < this.options.confirmationTimeoutMs) {
      for (const endpoint of endpoints) {
        const connection = this.rpcManager.getConnection(endpoint);
        const status = await this.confirmOnConnection(connection, signature);
        if (status === "confirmed") return "confirmed";
        if (status === "failed") return "failed";
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return "unknown";
  }

  private async confirmOnConnection(connection: Connection, signature: string): Promise<ConfirmationStatus> {
    try {
      const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
      const value = status.value;
      if (!value) return "unknown";
      if (value.err) return "failed";
      if (value.confirmationStatus === "confirmed" || value.confirmationStatus === "finalized") return "confirmed";
      return "unknown";
    } catch {
      this.rpcManager.reportEndpointFailure(connection.rpcEndpoint);
      return "unknown";
    }
  }
}
