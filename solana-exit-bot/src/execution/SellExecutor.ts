import { Keypair, PublicKey } from "@solana/web3.js";
import { Logger } from "../logging/Logger.js";
import { PositionManager } from "../position/PositionManager.js";
import { BotConfig, ExitLatencyTimestamps, Position, Quote, SellExecutionResult, TriggerDecision } from "../types.js";
import { PriorityFeeManager } from "./PriorityFeeManager.js";
import { QuoteProvider } from "./QuoteProvider.js";
import { RetryManager } from "./RetryManager.js";
import { ExecutionAttemptTracker } from "./ExecutionAttempt.js";
import { signBuiltTransaction, SellTransactionBuilder } from "./TransactionBuilder.js";
import { TransactionSubmissionUncertainError, TransactionTransport } from "./TransactionTransport.js";

interface QueueItem {
  mint: string;
  decision: TriggerDecision;
  marketEventAt: number;
}

export class SellExecutor {
  private readonly queue: QueueItem[] = [];
  private running = false;
  private readonly activeMints = new Set<string>();
  private readonly lastDecisionByMint = new Map<string, { trigger: TriggerDecision["trigger"]; at: number }>();
  private executionSequence = 0;

  constructor(
    private readonly config: BotConfig,
    private readonly positions: PositionManager,
    private readonly quoteProvider: QuoteProvider,
    private readonly txBuilder: SellTransactionBuilder,
    private readonly retryManager: RetryManager,
    private readonly feeManager: PriorityFeeManager,
    private readonly transport: TransactionTransport,
    private readonly logger: Logger,
    private readonly wallet?: Keypair
  ) {}

  enqueue(decision: TriggerDecision, mint: string, marketEventAt = Date.now()): void {
    const position = this.positions.get(mint);
    if (!position) return;
    if (position.sellState === "SELLING" || position.sellState === "SOLD") return;

    const previous = this.lastDecisionByMint.get(mint);
    if (previous && previous.trigger === decision.trigger && Date.now() - previous.at < this.config.risk.decisionCooldownMs) return;

    this.lastDecisionByMint.set(mint, { trigger: decision.trigger, at: Date.now() });
    this.queue.push({ mint, decision, marketEventAt });
    this.kick();
  }

  private kick(): void {
    if (this.running) return;
    this.running = true;
    void this.processLoop();
  }

  private async processLoop(): Promise<void> {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) continue;
      if (this.activeMints.has(item.mint)) continue;
      this.activeMints.add(item.mint);
      try {
        await this.processItem(item.mint, item.decision, item.marketEventAt);
      } catch (error) {
        this.logger.error("Sell execution crashed", {
          mint: item.mint,
          trigger: item.decision.trigger,
          error: error instanceof Error ? error.message : String(error)
        });
        const position = this.positions.get(item.mint);
        if (position && position.sellState === "SELLING") this.positions.setSellState(item.mint, "FAILED");
      } finally {
        this.activeMints.delete(item.mint);
      }
    }
    this.running = false;
  }

  private async processItem(mint: string, decision: TriggerDecision, marketEventAt: number): Promise<void> {
    const position = this.positions.get(mint);
    if (!position || position.sellState === "SOLD") return;

    this.positions.setSellState(mint, "SELLING");
    position.lastTrigger = decision.trigger;
    position.lastSellAttempt = Date.now();

    let lastFailure = "no execution attempt completed";

    for (const attempt of this.retryManager.attempts()) {
      const current = this.positions.get(mint);
      if (!current || current.remainingPercentage <= 0) return;

      try {
        const riskDecisionAt = Date.now();
        const quoteRequestedAt = Date.now();
        const quote = await this.quoteProvider.quoteForPosition(current, this.config.market.outputMint, decision.sellPct, this.config.execution.quoteSlippageBps);
        const quoteReceivedAt = Date.now();

        const quoteValidation = this.validateQuote(current, quote);
        if (!quoteValidation.ok) {
          lastFailure = quoteValidation.reason;
          this.logger.warn("Quote rejected", { mint, reason: quoteValidation.reason, trigger: decision.trigger, attempt });
          continue;
        }

        const emergencyFee = decision.trigger === "EMERGENCY" || decision.riskScore >= this.config.risk.riskScoreEmergency;
        const priorityFeeMicrolamports = await this.feeManager.resolveFee(decision, attempt, emergencyFee);
        const walletPubkey = this.resolveWalletPublicKey(current);
        const tx = await this.txBuilder.buildSellTransaction({ wallet: walletPubkey, position: current, quote, priorityFeeMicrolamports });

        const timestamps: ExitLatencyTimestamps = {
          marketEventAt,
          riskDecisionAt,
          quoteRequestedAt,
          quoteReceivedAt,
          transactionBuiltAt: Date.now()
        };

        if (this.config.mode === "paper") {
          await new Promise((resolve) => setTimeout(resolve, this.config.execution.simulationLatencyMs));
          const expectedOut = quote.expectedOutAmount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(quote.expectedOutAmount) : Number.MAX_VALUE;
          this.positions.applyFill(mint, decision.sellPct, expectedOut, "paper-simulated");
          this.logExit(current, decision, quote, priorityFeeMicrolamports, "paper-simulated", "confirmed", timestamps);
          return;
        }

        if (this.config.mode === "dry-run" || this.config.dryRun) {
          this.positions.setSellState(mint, "IDLE");
          this.logExit(current, decision, quote, priorityFeeMicrolamports, "dry-run", "unknown", timestamps);
          return;
        }

        if (!this.wallet) throw new Error("Live mode requires loaded wallet");

        timestamps.transactionSignedAt = Date.now();
        const signed = signBuiltTransaction(tx, this.wallet);
        const result = await this.submitAndTrack(signed, current, quote, decision, priorityFeeMicrolamports, timestamps, attempt);
        if (result.status === "confirmed" || result.status === "unknown") return;

        // An expired transaction is safe to rebuild because the next retry performs
        // a completely fresh quote + build. The old serialized transaction is never resent.
        lastFailure = result.reason;
        this.logger.warn("Sell transaction failed; retrying with a fresh execution attempt", {
          mint,
          attempt,
          maxAttempts: this.config.execution.maxSellRetries,
          reason: result.reason,
          expired: result.status === "expired"
        });
      } catch (error) {
        lastFailure = error instanceof Error ? error.message : String(error);
        this.logger.warn("Sell attempt failed; retrying", {
          mint,
          attempt,
          maxAttempts: this.config.execution.maxSellRetries,
          error: lastFailure
        });
      }
    }

    this.positions.setSellState(mint, "FAILED");
    this.logger.error("All sell attempts exhausted", { mint, trigger: decision.trigger, attempts: this.config.execution.maxSellRetries, reason: lastFailure });
  }

  private async submitAndTrack(
    tx: Awaited<ReturnType<SellTransactionBuilder["buildSellTransaction"]>>,
    position: Position,
    quote: Quote,
    decision: TriggerDecision,
    priorityFeeMicrolamports: number,
    timestamps: ExitLatencyTimestamps,
    attemptNumber: number
  ): Promise<SellExecutionResult> {
    const executionId = `${position.mint}:${decision.timestamp}:${++this.executionSequence}`;
    const tracker = new ExecutionAttemptTracker({ executionId, positionId: position.mint, trigger: decision.trigger, rebuildCount: attemptNumber });
    tracker.setTransaction({
      transactionHash: Buffer.from(tx.serialized).toString("base64"),
      recentBlockhash: tx.recentBlockhash,
      lastValidBlockHeight: tx.lastValidBlockHeight,
      quoteId: tx.quoteId
    });
    tracker.markBuilt(timestamps.transactionBuiltAt);
    tracker.markSigned(timestamps.transactionSignedAt ?? Date.now());

    const submittedAt = Date.now();
    try {
      const { signature, endpoint, duplicate } = await this.transport.send(tx);
      timestamps.transactionSubmittedAt = submittedAt;
      tracker.markSubmitted(endpoint, submittedAt);
      tracker.markProcessing();

      const status = await this.transport.confirm(signature, tx);
      timestamps.confirmationAt = Date.now();

      if (status === "confirmed") {
        const expectedOut = quote.expectedOutAmount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(quote.expectedOutAmount) : Number.MAX_VALUE;
        this.positions.applyFill(position.mint, decision.sellPct, expectedOut, signature);
        tracker.markConfirmed(timestamps.confirmationAt);
      } else if (status === "expired") {
        tracker.markExpired(timestamps.confirmationAt);
      } else if (status === "unknown") {
        tracker.markUnknown();
        this.positions.setSellState(position.mint, "UNKNOWN");
      } else {
        tracker.markFailed(timestamps.confirmationAt);
        this.positions.setSellState(position.mint, "FAILED");
      }

      this.logger.info("execution_attempt", tracker.attempt);
      this.logExit(position, decision, quote, priorityFeeMicrolamports, signature, status, timestamps, endpoint, duplicate);
      return { submitted: true, signature, reason: status, status };
    } catch (error) {
      if (error instanceof TransactionSubmissionUncertainError) {
        timestamps.transactionSubmittedAt = submittedAt;
        tracker.markSubmitted(error.endpoint, submittedAt);
        tracker.markProcessing();
        tracker.markUnknown();
        this.positions.setSellState(position.mint, "UNKNOWN");
        this.logger.warn("execution_attempt_uncertain", {
          ...tracker.attempt,
          signature: error.signature,
          error: error.message
        });
        this.logExit(position, decision, quote, priorityFeeMicrolamports, error.signature, "unknown", timestamps, error.endpoint, false);
        return { submitted: true, signature: error.signature, reason: "unknown", status: "unknown" };
      }

      tracker.markUnknown();
      this.logger.warn("execution_attempt_uncertain", { ...tracker.attempt, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  private validateQuote(position: Position, quote: Quote): { ok: true } | { ok: false; reason: string } {
    const remainingAmount = position.amount * (position.remainingPercentage / 100);
    if (!Number.isFinite(remainingAmount) || remainingAmount <= 0) return { ok: false, reason: "insufficient token balance" };
    if (quote.inAmount <= 0n) return { ok: false, reason: "invalid token amount" };
    if (!quote.routeAvailable) return { ok: false, reason: "no route" };
    if (quote.expectedOutAmount <= 0n || quote.minimumOutAmount <= 0n) return { ok: false, reason: "zero output" };
    if (quote.minimumOutAmount > quote.expectedOutAmount) return { ok: false, reason: "invalid minimum output" };
    if (!Number.isFinite(quote.priceImpactBps) || quote.priceImpactBps < 0) return { ok: false, reason: "invalid price impact" };
    if (quote.priceImpactBps > this.config.risk.maxPriceImpactBps) return { ok: false, reason: "excessive price impact" };
    if (!Number.isFinite(quote.timestamp) || quote.timestamp <= 0) return { ok: false, reason: "invalid quote timestamp" };
    const quoteAgeMs = Date.now() - quote.timestamp;
    if (quoteAgeMs < 0) return { ok: false, reason: "quote timestamp is in the future" };
    if (quoteAgeMs > this.config.execution.quoteStaleMs) return { ok: false, reason: "stale quote" };
    return { ok: true };
  }

  private resolveWalletPublicKey(position: Position): PublicKey {
    if (this.wallet) return this.wallet.publicKey;
    try { return new PublicKey(position.walletAddress); } catch { return Keypair.generate().publicKey; }
  }

  private logExit(
    position: Position,
    decision: TriggerDecision,
    quote: Quote,
    priorityFee: number,
    signature: string,
    status: "confirmed" | "failed" | "unknown" | "expired",
    timestamps: ExitLatencyTimestamps,
    rpcEndpoint?: string,
    duplicateSend?: boolean
  ): void {
    const signalLatencyMs = timestamps.riskDecisionAt - timestamps.marketEventAt;
    const quoteLatencyMs = timestamps.quoteReceivedAt - timestamps.quoteRequestedAt;
    const buildLatencyMs = timestamps.transactionBuiltAt - timestamps.quoteReceivedAt;
    const submissionLatencyMs = timestamps.transactionSubmittedAt ? timestamps.transactionSubmittedAt - timestamps.transactionBuiltAt : undefined;
    const confirmationLatencyMs = timestamps.confirmationAt && timestamps.transactionSubmittedAt ? timestamps.confirmationAt - timestamps.transactionSubmittedAt : undefined;
    const totalExitLatencyMs = timestamps.confirmationAt ? timestamps.confirmationAt - timestamps.marketEventAt : undefined;

    this.logger.info("exit_execution", {
      positionId: position.mint,
      mint: position.mint,
      trigger: decision.trigger,
      riskScore: decision.riskScore,
      sellPercentage: decision.sellPct,
      expectedOutput: quote.expectedOutAmount.toString(),
      priceImpactBps: quote.priceImpactBps,
      priorityFee,
      rpcEndpoint,
      transactionSignature: signature,
      duplicateSend,
      timestamps,
      latencies: { signalLatencyMs, quoteLatencyMs, buildLatencyMs, submissionLatencyMs, confirmationLatencyMs, totalExitLatencyMs },
      finalState: status
    });
  }
}
