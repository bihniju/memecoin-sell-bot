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

interface SignatureObservation {
  status: ConfirmationStatus;
  absent: boolean;
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

    const endpoints = this.rpcManager.getEndpointsInPriorityOrder();
    const candidates = endpoints.length > 0 ? endpoints : [this.rpcManager.getActiveEndpoint()];
    let lastError: unknown;

    for (const endpoint of candidates) {
      if (transaction.lastValidBlockHeight !== undefined) {
        const currentBlockHeight = await this.getCurrentBlockHeight();
        if (currentBlockHeight > transaction.lastValidBlockHeight) {
          throw new Error(`Transaction blockhash expired before broadcast: current=${currentBlockHeight} lastValid=${transaction.lastValidBlockHeight}`);
        }
      }

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

        if (this.isBlockhashExpiredError(error)) {
          throw error;
        }

        if (this.isSubmissionUncertainError(error)) {
          const signature = this.deriveSignature(transaction);
          if (signature) {
            const reconciliation = await this.confirm(signature, transaction);
            if (reconciliation === "confirmed" || reconciliation === "finalized") {
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
      let successfulAbsentLookup = false;

      for (const endpoint of candidates) {
        const connection = this.rpcManager.getConnection(endpoint);
        const observation = await this.confirmOnConnection(connection, signature);
        if (observation.status === "confirmed" || observation.status === "finalized" || observation.status === "failed") return observation.status;
        successfulAbsentLookup ||= observation.absent;

        if (transaction?.lastValidBlockHeight !== undefined) {
          try {
            const blockHeight = await connection.getBlockHeight("confirmed");
            highestObservedBlockHeight = Math.max(highestObservedBlockHeight ?? blockHeight, blockHeight);
            if (blockHeight > transaction.lastValidBlockHeight) {
              const finalObservation = await this.confirmOnConnection(connection, signature);
              if (finalObservation.status === "confirmed" || finalObservation.status === "finalized" || finalObservation.status === "failed") return finalObservation.status;
              successfulAbsentLookup ||= finalObservation.absent;
            }
          } catch {
            // A block-height RPC failure is uncertainty, not proof of expiry.
          }
        }
      }

      if (transaction?.lastValidBlockHeight !== undefined && highestObservedBlockHeight !== undefined && highestObservedBlockHeight > transaction.lastValidBlockHeight && successfulAbsentLookup) {
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
    let highestBlockHeight: number | undefined;
    let lastError: unknown;
    for (const endpoint of candidates) {
      const started = Date.now();
      try {
        const connection = this.rpcManager.getConnection(endpoint);
        const blockHeight = await connection.getBlockHeight("confirmed");
        highestBlockHeight = Math.max(highestBlockHeight ?? blockHeight, blockHeight);
        await this.rpcManager.recordHealthCheck(endpoint, Date.now() - started, true);
      } catch (error) {
        lastError = error;
        await this.rpcManager.recordHealthCheck(endpoint, Date.now() - started, false);
      }
    }
    if (highestBlockHeight !== undefined) return highestBlockHeight;
    throw new Error(`Unable to read Solana block height before broadcast: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  private async confirmOnConnection(connection: Connection, signature: string): Promise<SignatureObservation> {
    const started = Date.now();
    try {
      const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
      await this.rpcManager.recordHealthCheck(connection.rpcEndpoint, Date.now() - started, true);
      const value = status.value;
      if (!value) return { status: "unknown", absent: true };
      if (value.err) return { status: "failed", absent: false };
      if (value.confirmationStatus === "finalized") return { status: "finalized", absent: false };
      if (value.confirmationStatus === "confirmed") return { status: "confirmed", absent: false };
      return { status: "unknown", absent: false };
    } catch {
      await this.rpcManager.recordHealthCheck(connection.rpcEndpoint, Date.now() - started, false);
      return { status: "unknown", absent: false };
    }
  }

  private isSubmissionUncertainError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const text = `${error.name} ${error.message}`.toLowerCase();
    return /abort|timeout|timed out|timedout|network|fetch failed|socket|econnreset|etimedout|eai_again|502|503|504/.test(text);
  }

  private isBlockhashExpiredError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return /blockhash.*(expired|not found|too old)|transaction.*expired/i.test(error.message);
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
