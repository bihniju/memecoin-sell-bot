import { PublicKey } from "@solana/web3.js";
import { Position } from "../types.js";
import { RpcManager } from "../rpc/RpcManager.js";

export type PositionReconciliationResult =
  | "UNCHANGED"
  | "PARTIALLY_SOLD"
  | "SOLD"
  | "AMBIGUOUS"
  | "UNAVAILABLE";

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
    let lastError: unknown;

    for (const endpoint of candidates) {
      const started = Date.now();
      try {
        const accounts = await this.rpcManager.getConnection(endpoint).getParsedTokenAccountsByOwner(wallet, { mint }, "confirmed");
        const observedRaw = accounts.value.reduce((sum, account) => {
          const amount = account.account.data.parsed?.info?.tokenAmount?.amount;
          return sum + (typeof amount === "string" ? BigInt(amount) : 0n);
        }, 0n);
        await this.rpcManager.recordHealthCheck(endpoint, Date.now() - started, true);

        if (observedRaw === currentRaw) return "UNCHANGED";
        const expectedAfterSell = currentRaw >= expectedSoldAmountRaw ? currentRaw - expectedSoldAmountRaw : 0n;
        if (observedRaw !== expectedAfterSell) return "AMBIGUOUS";

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
    return "UNAVAILABLE";
  }

  private currentPositionRaw(position: Position): bigint {
    const initial = position.amountRaw ?? 0n;
    return (initial * BigInt(Math.round(position.remainingPercentage * 1_000_000))) / 100_000_000n;
  }
}
