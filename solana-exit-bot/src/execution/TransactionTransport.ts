import { Connection, SendOptions } from "@solana/web3.js";
import { BuiltTransaction, ConfirmationStatus } from "../types.js";
import { RpcManager } from "../rpc/RpcManager.js";

export interface TransactionTransport {
  send(transaction: BuiltTransaction): Promise<{ signature: string; endpoint: string; duplicate: boolean }>;
  confirm(signature: string, transaction?: BuiltTransaction): Promise<ConfirmationStatus>;
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
    if (existing) return { signature: existing, endpoint: this.rpcManager.getActiveEndpoint(), duplicate: true };

    if (transaction.lastValidBlockHeight !== undefined) {
      const currentBlockHeight = await this.getCurrentBlockHeight();
      if (currentBlockHeight > transaction.lastValidBlockHeight) {
        throw new Error(`Transaction blockhash expired before broadcast: current=${currentBlockHeight} lastValid=${transaction.lastValidBlockHeight}`);
      }
    }

    const endpoints = this.rpcManager.getEndpointsInPriorityOrder();
    const candidates = endpoints.length > 0 ? endpoints : [this.rpcManager.getActiveEndpoint()];
    let lastError: unknown;

    for (const endpoint of candidates) {
      const started = Date.now();
      try {
        const connection = this.rpcManager.getConnection(endpoint);
        const signature = await connection.sendRawTransaction(transaction.serialized, {
          skipPreflight: this.options.skipPreflight,
          maxRetries: this.options.maxRetries
        } satisfies SendOptions);
        this.sentByHash.set(txHash, signature);
        await this.rpcManager.recordHealthCheck(endpoint, Date.now() - started, true);
        return { signature, endpoint, duplicate: false };
      } catch (error) {
        lastError = error;
        await this.rpcManager.recordHealthCheck(endpoint, Date.now() - started, false);
      }
    }

    throw new Error(`Transaction submission failed on all RPC endpoints: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  async confirm(signature: string, transaction?: BuiltTransaction): Promise<ConfirmationStatus> {
    const start = Date.now();
    let pollDelayMs = 25;

    while (Date.now() - start < this.options.confirmationTimeoutMs) {
      const endpoints = this.rpcManager.getEndpointsInPriorityOrder();
      const candidates = endpoints.length > 0 ? endpoints : [this.rpcManager.getActiveEndpoint()];
      let highestObservedBlockHeight: number | undefined;

      for (const endpoint of candidates) {
        const connection = this.rpcManager.getConnection(endpoint);
        const status = await this.confirmOnConnection(connection, signature);
        if (status === "confirmed" || status === "failed") return status;

        if (transaction?.lastValidBlockHeight !== undefined) {
          try {
            const blockHeight = await connection.getBlockHeight("confirmed");
            highestObservedBlockHeight = Math.max(highestObservedBlockHeight ?? blockHeight, blockHeight);
            if (blockHeight > transaction.lastValidBlockHeight) {
              // Always check signature status first. A transaction can land on a
              // different RPC even after the block height has passed locally.
              const finalStatus = await this.confirmOnConnection(connection, signature);
              if (finalStatus === "confirmed" || finalStatus === "failed") return finalStatus;
            }
          } catch {
            // A block-height RPC failure is uncertainty, not proof of expiry.
          }
        }
      }

      if (transaction?.lastValidBlockHeight !== undefined && highestObservedBlockHeight !== undefined && highestObservedBlockHeight > transaction.lastValidBlockHeight) {
        return "expired";
      }

      await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
      pollDelayMs = Math.min(100, pollDelayMs * 2);
    }

    return "unknown";
  }

  private async getCurrentBlockHeight(): Promise<number> {
    const endpoints = this.rpcManager.getEndpointsInPriorityOrder();
    const candidates = endpoints.length > 0 ? endpoints : [this.rpcManager.getActiveEndpoint()];
    let lastError: unknown;
    for (const endpoint of candidates) {
      const started = Date.now();
      try {
        const connection = this.rpcManager.getConnection(endpoint);
        const blockHeight = await connection.getBlockHeight("confirmed");
        await this.rpcManager.recordHealthCheck(endpoint, Date.now() - started, true);
        return blockHeight;
      } catch (error) {
        lastError = error;
        await this.rpcManager.recordHealthCheck(endpoint, Date.now() - started, false);
      }
    }
    throw new Error(`Unable to read Solana block height before broadcast: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  private async confirmOnConnection(connection: Connection, signature: string): Promise<ConfirmationStatus> {
    const started = Date.now();
    try {
      const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
      await this.rpcManager.recordHealthCheck(connection.rpcEndpoint, Date.now() - started, true);
      const value = status.value;
      if (!value) return "unknown";
      if (value.err) return "failed";
      if (value.confirmationStatus === "confirmed" || value.confirmationStatus === "finalized") return "confirmed";
      return "unknown";
    } catch {
      await this.rpcManager.recordHealthCheck(connection.rpcEndpoint, Date.now() - started, false);
      return "unknown";
    }
  }
}
