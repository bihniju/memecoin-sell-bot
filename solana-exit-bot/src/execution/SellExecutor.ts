import { Logger } from "../logging/Logger.js";
import { PositionManager } from "../position/PositionManager.js";
import { BuiltTransaction, BotConfig, Position, Quote, SellExecutionResult, TriggerDecision } from "../types.js";
import { PriorityFeeManager } from "./PriorityFeeManager.js";
import { QuoteProvider } from "./QuoteProvider.js";
import { RetryManager } from "./RetryManager.js";
import { TransactionBuilder } from "./TransactionBuilder.js";

export interface TransactionTransport {
  submit(tx: BuiltTransaction): Promise<{ signature: string }>;
  confirm(signature: string): Promise<boolean>;
}

export class InMemoryTransport implements TransactionTransport {
  async submit(): Promise<{ signature: string }> {
    return { signature: `sig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
  }

  async confirm(): Promise<boolean> {
    return true;
  }
}

interface QueueItem {
  mint: string;
  decision: TriggerDecision;
}

export class SellExecutor {
  private readonly queue: QueueItem[] = [];
  private running = false;
  private readonly activeMints = new Set<string>();

  constructor(
    private readonly config: BotConfig,
    private readonly positions: PositionManager,
    private readonly quoteProvider: QuoteProvider,
    private readonly txBuilder: TransactionBuilder,
    private readonly retryManager: RetryManager,
    private readonly feeManager: PriorityFeeManager,
    private readonly transport: TransactionTransport,
    private readonly logger: Logger
  ) {}

  enqueue(decision: TriggerDecision, mint: string): void {
    const position = this.positions.get(mint);
    if (!position) return;
    if (position.sellState === "SELLING" || position.sellState === "SOLD") return;
    this.queue.push({ mint, decision });
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
        await this.processItem(item.mint, item.decision);
      } finally {
        this.activeMints.delete(item.mint);
      }
    }
    this.running = false;
  }

  private async processItem(mint: string, decision: TriggerDecision): Promise<void> {
    const position = this.positions.get(mint);
    if (!position) return;
    if (position.sellState === "SOLD") return;

    this.positions.setSellState(mint, "SELLING");
    position.lastTrigger = decision.trigger;

    const signalDetectedAt = Date.now();

    for (const attempt of this.retryManager.attempts()) {
      const current = this.positions.get(mint);
      if (!current || current.remainingPercentage <= 0) return;

      const quoteReceivedAt = Date.now();
      const quote = await this.quoteProvider.getQuote(current, decision.sellPct);

      if (!quote.routeAvailable) {
        this.logger.warn("No route available", { mint, trigger: decision.trigger });
        continue;
      }

      if (quote.priceImpactBps > this.config.risk.maxPriceImpactBps) {
        this.logger.warn("Price impact too high", { mint, impact: quote.priceImpactBps });
        continue;
      }

      const priorityFeeMicrolamports = this.feeManager.resolveFee(decision, attempt);
      const transactionBuiltAt = Date.now();
      const tx = this.txBuilder.build(current, quote, priorityFeeMicrolamports);

      if (this.config.dryRun || this.config.mode !== "live") {
        this.logDryRun(decision, current, quote, { signalDetectedAt, quoteReceivedAt, transactionBuiltAt });
        this.positions.applyFill(mint, decision.sellPct, quote.outAmount, "dry-run");
        return;
      }

      const result = await this.submitAndTrack(tx, current, quote, decision, signalDetectedAt, quoteReceivedAt, transactionBuiltAt);
      if (result.submitted) return;
    }

    this.positions.setSellState(mint, "FAILED");
  }

  private async submitAndTrack(
    tx: BuiltTransaction,
    position: Position,
    quote: Quote,
    decision: TriggerDecision,
    signalDetectedAt: number,
    quoteReceivedAt: number,
    transactionBuiltAt: number
  ): Promise<SellExecutionResult> {
    const transactionSubmittedAt = Date.now();
    const { signature } = await this.transport.submit(tx);

    this.logger.info("Submitted sell transaction", {
      mint: position.mint,
      signature,
      trigger: decision.trigger,
      signalToQuoteMs: quoteReceivedAt - signalDetectedAt,
      quoteToBuildMs: transactionBuiltAt - quoteReceivedAt,
      buildToSubmitMs: transactionSubmittedAt - transactionBuiltAt
    });

    void (async () => {
      const confirmationAt = Date.now();
      const confirmed = await this.transport.confirm(signature);
      if (confirmed) {
        this.positions.applyFill(position.mint, decision.sellPct, quote.outAmount, signature);
        this.logger.info("Sell transaction confirmed", {
          mint: position.mint,
          signature,
          submitToConfirmMs: confirmationAt - transactionSubmittedAt
        });
      } else {
        this.positions.setSellState(position.mint, "FAILED");
      }
    })();

    return { submitted: true, signature, reason: "submitted" };
  }

  private logDryRun(
    decision: TriggerDecision,
    position: Position,
    quote: Quote,
    latency: { signalDetectedAt: number; quoteReceivedAt: number; transactionBuiltAt: number }
  ): void {
    this.logger.info("[DRY RUN] Would SELL", {
      mint: position.mint,
      sellPct: decision.sellPct,
      reason: decision.trigger,
      entry: position.entryPrice,
      current: position.currentPrice,
      pnlPct: decision.pnlPct,
      riskScore: decision.riskScore,
      expectedOut: quote.outAmount,
      signalToQuoteMs: latency.quoteReceivedAt - latency.signalDetectedAt,
      quoteToBuildMs: latency.transactionBuiltAt - latency.quoteReceivedAt
    });
  }
}
