import { PublicKey } from "@solana/web3.js";
import { Position } from "../types.js";
import { RpcManager } from "../rpc/RpcManager.js";

export type PositionReconciliationResult =
  | "UNCHANGED"
  | "PARTIALLY_SOLD"
  | "SOLD"
  | "AMBIGUOUS"
  | "UNAVAILABLE";

type SignatureState = "confirmed" | "finalized" | "failed" | "unknown" | "unavailable";

export class PositionReconciler {
  constructor(private readonly rpcManager: RpcManager) {}

  async reconcile(position: Position, expectedSoldAmountRaw: bigint, signature?: string): Promise<PositionReconciliationResult> {
    if (position.amountRaw === undefined || position.amountRaw <= 0n || expectedSoldAmountRaw <= 0n) return "UNAVAILABLE";

    let wallet: PublicKey;
    let mint: PublicKey;
    try {
      wallet = new PublicKey(position.walletAddress);
      mint = new PublicKey(position.mint);
    } catch {
      return "UNAVAILABLE";
    }

    const currentRaw = this.currentPositionRaw(position);
    const endpoints = this.rpcManager.getEndpointsInPriorityOrder();
    const candidates = endpoints.length > 0 ? endpoints : [this.rpcManager.getActiveEndpoint()];
    let anyHealthyEndpoint = false;
    let anySignatureObserved = false;
    let lastError: unknown;

    for (const endpoint of candidates) {
      const started = Date.now();
      try {
        const connection = this.rpcManager.getConnection(endpoint);

        if (signature) {
          const signatureState = await this.getSignatureState(connection, signature);
          if (signatureState === "failed") {
            anyHealthyEndpoint = true;
            anySignatureObserved = true;
            await this.rpcManager.recordHealthCheck(endpoint, Date.now() - started, true);
            return "UNCHANGED";
          }
          if (signatureState === "confirmed" || signatureState === "finalized") {
            anyHealthyEndpoint = true;
            anySignatureObserved = true;
          } else if (signatureState === "unknown") {
            anyHealthyEndpoint = true;
          } else {
            throw new Error("signature status unavailable");
          }
        }

        const accounts = await connection.getParsedTokenAccountsByOwner(wallet, { mint }, "confirmed");
        const observedRaw = accounts.value.reduce((sum, account) => {
          const amount = account.account.data.parsed?.info?.tokenAmount?.amount;
          return sum + (typeof amount === "string" ? BigInt(amount) : 0n);
        }, 0n);
        anyHealthyEndpoint = true;
        await this.rpcManager.recordHealthCheck(endpoint, Date.now() - started, true);

        if (observedRaw === currentRaw) return "UNCHANGED";
        const expectedAfterSell = currentRaw >= expectedSoldAmountRaw ? currentRaw - expectedSoldAmountRaw : 0n;
        if (observedRaw !== expectedAfterSell) return "AMBIGUOUS";

        // A matching balance change is only accepted after at least one healthy
        // endpoint has also been queried for the submitted signature. If the
        // signature is not yet indexed, the balance remains corroborating evidence.
        if (signature && !anySignatureObserved) continue;

        const remainingPercentage = Number(observedRaw) / Number(position.amountRaw) * 100;
        if (!Number.isFinite(remainingPercentage)) return "AMBIGUOUS";

        position.remainingPercentage = Math.max(0, Math.min(100, remainingPercentage));
        position.sellSignature = signature ?? position.sellSignature;
        position.lastSellAttempt = Date.now();
        position.sellState = position.remainingPercentage <= 0 ? "SOLD" : "PARTIALLY_SOLD";
        return position.remainingPercentage <= 0 ? "SOLD" : "PARTIALLY_SOLD";
      } catch (error) {
        lastError = error;
        await this.rpcManager.recordHealthCheck(endpoint, Date.now() - started, false);
      }
    }

    void lastError;
    if (anyHealthyEndpoint) return "UNAVAILABLE";
    return "UNAVAILABLE";
  }

  private async getSignatureState(connection: ReturnType<RpcManager["getConnection"]>, signature: string): Promise<SignatureState> {
    try {
      const response = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
      const value = response.value;
      if (!value) return "unknown";
      if (value.err) return "failed";
      if (value.confirmationStatus === "finalized") return "finalized";
      if (value.confirmationStatus === "confirmed") return "confirmed";
      return "unknown";
    } catch {
      return "unavailable";
    }
  }

  private currentPositionRaw(position: Position): bigint {
    const initial = position.amountRaw ?? 0n;
    return (initial * BigInt(Math.round(position.remainingPercentage * 1_000_000))) / 100_000_000n;
  }
}
