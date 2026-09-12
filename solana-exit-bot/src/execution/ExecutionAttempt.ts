import { ExitTrigger, ExecutionAttempt } from "../types.js";

const now = () => Date.now();

export class ExecutionAttemptTracker {
  readonly attempt: ExecutionAttempt;

  constructor(params: { executionId: string; positionId: string; trigger: ExitTrigger; rebuildCount?: number }) {
    this.attempt = {
      executionId: params.executionId,
      positionId: params.positionId,
      trigger: params.trigger,
      rebuildCount: params.rebuildCount ?? 0,
      status: "BUILT"
    };
  }

  setTransaction(params: { transactionHash: string; recentBlockhash?: string; lastValidBlockHeight?: number; quoteId?: string }): void {
    this.attempt.transactionHash = params.transactionHash;
    this.attempt.recentBlockhash = params.recentBlockhash;
    this.attempt.lastValidBlockHeight = params.lastValidBlockHeight;
    this.attempt.quoteId = params.quoteId;
  }

  markBuilt(at = now()): void { this.attempt.builtAt = at; this.attempt.status = "BUILT"; }
  markSigned(at = now()): void { this.attempt.signedAt = at; this.attempt.status = "SIGNED"; }
  markSubmitted(endpoint: string, at = now()): void { this.attempt.submittedAt = at; this.attempt.rpcEndpoint = endpoint; this.attempt.status = "SUBMITTED"; }
  markProcessing(at = now()): void { this.attempt.processedAt = at; this.attempt.status = "PROCESSING"; }
  markConfirmed(at = now(), finalized = false): void {
    this.attempt.confirmedAt = at;
    this.attempt.finalizedAt = finalized ? at : this.attempt.finalizedAt;
    this.attempt.status = finalized ? "FINALIZED" : "CONFIRMED";
  }
  markFailed(at = now()): void { this.attempt.status = "FAILED"; this.attempt.failedAt = at; }
  markUnknown(): void { this.attempt.status = "UNKNOWN"; }
  markExpired(at = now()): void { this.attempt.expiryDetectedAt = at; this.attempt.status = "EXPIRED"; }
  markReconciling(): void { this.attempt.status = "RECONCILING"; }
  markRebuilt(): void { this.attempt.rebuildCount += 1; this.attempt.status = "REBUILT"; }
  setReconciliationResult(result: string): void { this.attempt.reconciliationResult = result; }
}
