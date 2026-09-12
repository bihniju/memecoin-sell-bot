export class InMemoryTransport {
    async submit() {
        return { signature: `sig-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
    }
    async confirm() {
        return true;
    }
}
export class SellExecutor {
    config;
    positions;
    quoteProvider;
    txBuilder;
    retryManager;
    feeManager;
    transport;
    logger;
    queue = [];
    running = false;
    activeMints = new Set();
    constructor(config, positions, quoteProvider, txBuilder, retryManager, feeManager, transport, logger) {
        this.config = config;
        this.positions = positions;
        this.quoteProvider = quoteProvider;
        this.txBuilder = txBuilder;
        this.retryManager = retryManager;
        this.feeManager = feeManager;
        this.transport = transport;
        this.logger = logger;
    }
    enqueue(decision, mint) {
        const position = this.positions.get(mint);
        if (!position)
            return;
        if (position.sellState === "SELLING" || position.sellState === "SOLD")
            return;
        this.queue.push({ mint, decision });
        this.kick();
    }
    kick() {
        if (this.running)
            return;
        this.running = true;
        void this.processLoop();
    }
    async processLoop() {
        while (this.queue.length > 0) {
            const item = this.queue.shift();
            if (!item)
                continue;
            if (this.activeMints.has(item.mint))
                continue;
            this.activeMints.add(item.mint);
            try {
                await this.processItem(item.mint, item.decision);
            }
            finally {
                this.activeMints.delete(item.mint);
            }
        }
        this.running = false;
    }
    async processItem(mint, decision) {
        const position = this.positions.get(mint);
        if (!position)
            return;
        if (position.sellState === "SOLD")
            return;
        this.positions.setSellState(mint, "SELLING");
        position.lastTrigger = decision.trigger;
        const signalDetectedAt = Date.now();
        for (const attempt of this.retryManager.attempts()) {
            const current = this.positions.get(mint);
            if (!current || current.remainingPercentage <= 0)
                return;
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
            if (result.submitted)
                return;
        }
        this.positions.setSellState(mint, "FAILED");
    }
    async submitAndTrack(tx, position, quote, decision, signalDetectedAt, quoteReceivedAt, transactionBuiltAt) {
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
            }
            else {
                this.positions.setSellState(position.mint, "FAILED");
            }
        })();
        return { submitted: true, signature, reason: "submitted" };
    }
    logDryRun(decision, position, quote, latency) {
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
