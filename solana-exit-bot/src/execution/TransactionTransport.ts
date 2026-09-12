import { Connection, SendOptions, VersionedTransaction } from "@solana/web3.js";
import { BuiltTransaction, ConfirmationStatus } from "../types.js";
import { RpcManager } from "../rpc/RpcManager.js";

export class TransactionSubmissionUncertainError extends Error {
  constructor(
    public readonly signature: string,
    public readonly endpoint: string,
    cause?: unknown
  ) {
    super(`Transaction submission uncertain for ${signature} via ${endpoint}: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "TransactionSubmissionUncertainError";
  }
}

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

        // A network/timeout failure can happen after the RPC accepted the
        // transaction. Never send the same signed transaction to another RPC
        // until we have reconciled the original signature.
        if (this.isSubmissionUncertainError(error)) {
          const signature = this.deriveSignature(transaction);
          if (signature) {
            const reconciliation = await this.confirm(signature, transaction);
            if (reconciliation === "confirmed") {
              this.sentByHash.set(txHash, signature);
              return { signature, endpoint, duplicate: false };
            }
            if (reconciliation === "failed" || reconciliation === "expired") {
              throw new Error(`Transaction submission failed after reconciliation: ${reconciliation}`);
            }
            throw new TransactionSubmissionUncertainError(signature, endpoint, error);
          }
          throw new TransactionSubmissionUncertainError("unknown", endpoint, error);
        }
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

  private isSubmissionUncertainError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const text = `${error.name} ${error.message}`.toLowerCase();
    return /abort|timeout|timed out|timedout|network|fetch failed|socket|econnreset|etimedout|eai_again|502|503|504/.test(text);
  }

  private deriveSignature(transaction: BuiltTransaction): string | undefined {
    try {
      const parsed = VersionedTransaction.deserialize(transaction.serialized);
      const signature = parsed.signatures[0];
      if (!signature || signature.every((byte) => byte === 0)) return undefined;
      return encodeBase58(signature);
    } catch {
      return undefined;
    }
  }
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    const remainder = Number(value % 58n);
    encoded = BASE58_ALPHABET[remainder] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded || "1";
}
