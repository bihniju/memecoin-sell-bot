import { Keypair, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { describe, expect, test } from "vitest";
import { PriorityFeeManager } from "../src/execution/PriorityFeeManager.js";
import { QuoteProvider } from "../src/execution/QuoteProvider.js";
import { RetryManager } from "../src/execution/RetryManager.js";
import { SellExecutor } from "../src/execution/SellExecutor.js";
import { TransactionTransport } from "../src/execution/TransactionTransport.js";
import { SellTransactionBuilder } from "../src/execution/TransactionBuilder.js";
import { Logger } from "../src/logging/Logger.js";
import { PositionManager } from "../src/position/PositionManager.js";
import { PositionReconciler, PositionReconciliationResult } from "../src/position/PositionReconciler.js";
import { createPosition } from "../src/position/PositionState.js";
import { BotConfig, Quote, TriggerDecision } from "../src/types.js";

const baseConfig = (): BotConfig => ({
  mode: "live",
  dryRun: false,
  logLevel: "error",
  risk: {
    stopLossEnabled: true,
    stopLossPct: 5,
    earlyExitEnabled: true,
    earlyExitPct: 2,
    fallingMarketEnabled: true,
    fallingWindowMs: 3000,
    fallingDropPct: 1.5,
    consecutiveLowerTicks: 3,
    riskScoreWarning: 40,
    riskScoreHigh: 60,
    riskScoreEmergency: 80,
    fallingWeightPriceDrop: 40,
    fallingWeightLowerTicks: 20,
    fallingWeightAcceleration: 20,
    fallingWeightVolumeImbalance: 10,
    fallingWeightLiquidity: 10,
    trailingStopEnabled: true,
    trailingActivationPct: 20,
    trailingStopPct: 8,
    takeProfitEnabled: true,
    takeProfitLevels: [],
    maxPriceImpactBps: 1500,
    decisionCooldownMs: 500
  },
  execution: {
    maxSellRetries: 3,
    priorityFeeEnabled: true,
    priorityFeeMode: "dynamic",
    minPriorityFeeMicrolamports: 1000,
    maxPriorityFeeMicrolamports: 50000,
    emergencyPriorityFeeMicrolamports: 100000,
    quoteSlippageBps: 250,
    quoteStaleMs: 1000,
    skipPreflight: false,
    maxRpcSendRetries: 2,
    confirmationTimeoutMs: 500,
    simulationLatencyMs: 5
  },
  rpc: {
    network: "mainnet-beta",
    rpcEndpoints: ["http://localhost:8899"],
    websocketEndpoints: ["ws://localhost:8900"],
    staleMarketMs: 1500
  },
  wallet: {
    liveTradingEnabled: true,
    walletKeypairPath: undefined
  },
  market: {
    outputMint: "So11111111111111111111111111111111111111112",
    quoteApiUrl: "https://example.com/quote",
    swapApiUrl: "https://example.com/swap",
    websocketProvider: "solana",
    sampleDebounceMs: 100,
    heartbeatMs: 1000
  }
});

const decision: TriggerDecision = {
  trigger: "RAPID_DECLINE",
  reason: "risk",
  timestamp: Date.now(),
  price: 0.9,
  entryPrice: 1,
  pnlPct: -10,
  riskScore: 90,
  sellPct: 100
};

class TestQuoteProvider implements QuoteProvider {
  constructor(private readonly quote: Quote) {}

  async getQuote(): Promise<Quote> {
    return this.quote;
  }

  async quoteForPosition(): Promise<Quote> {
    return this.quote;
  }
}

class TestBuilder implements SellTransactionBuilder {
  builds = 0;

  async buildSellTransaction(params: Parameters<SellTransactionBuilder["buildSellTransaction"]>[0]) {
    this.builds += 1;
    const message = new TransactionMessage({
      payerKey: params.wallet,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: []
    }).compileToV0Message([]);
    const transaction = new VersionedTransaction(message);
    return {
      serialized: transaction.serialize(),
      transaction,
      priorityFeeMicrolamports: 1000,
      minOutAmount: 1n
    };
  }
}

class TestTransport implements TransactionTransport {
  sends = 0;
  constructor(private readonly status: "confirmed" | "failed" | "unknown") {}

  async send() {
    this.sends += 1;
    return { signature: `sig-${this.sends}`, endpoint: "rpc-a", duplicate: false };
  }

  async confirm() {
    return this.status;
  }
}

class TestReconciler implements Pick<PositionReconciler, "reconcile"> {
  calls = 0;
  constructor(private readonly result: PositionReconciliationResult) {}

  async reconcile() {
    this.calls += 1;
    return this.result;
  }
}

describe("SellExecutor", () => {
  test("duplicate sell prevention keeps one active operation", async () => {
    const config = baseConfig();
    const pm = new PositionManager();
    pm.upsert(createPosition({ mint: "m", decimals: 6, walletAddress: Keypair.generate().publicKey.toBase58(), amount: 100, entryPrice: 1 }));

    const quote: Quote = {
      provider: "test",
      inAmount: 100n,
      expectedOutAmount: 90n,
      minimumOutAmount: 80n,
      priceImpactBps: 300,
      routeAvailable: true,
      routeInfo: {},
      timestamp: Date.now()
    };

    const transport = new TestTransport("confirmed");
    const executor = new SellExecutor(
      config,
      pm,
      new TestQuoteProvider(quote),
      new TestBuilder(),
      new RetryManager(config.execution),
      new PriorityFeeManager(config.execution),
      transport,
      new Logger("error"),
      Keypair.generate()
    );

    executor.enqueue(decision, "m");
    executor.enqueue(decision, "m");
    await new Promise((r) => setTimeout(r, 50));

    expect(transport.sends).toBe(1);
    expect(pm.get("m")?.sellState).toBe("SOLD");
  });

  test("stale quote is rejected", async () => {
    const config = baseConfig();
    config.execution.quoteStaleMs = 1;
    const pm = new PositionManager();
    pm.upsert(createPosition({ mint: "m", decimals: 6, walletAddress: Keypair.generate().publicKey.toBase58(), amount: 100, entryPrice: 1 }));

    const quote: Quote = {
      provider: "test",
      inAmount: 100n,
      expectedOutAmount: 90n,
      minimumOutAmount: 80n,
      priceImpactBps: 300,
      routeAvailable: true,
      routeInfo: {},
      timestamp: Date.now() - 10_000
    };

    const transport = new TestTransport("confirmed");
    const executor = new SellExecutor(
      config,
      pm,
      new TestQuoteProvider(quote),
      new TestBuilder(),
      new RetryManager(config.execution),
      new PriorityFeeManager(config.execution),
      transport,
      new Logger("error"),
      Keypair.generate()
    );

    executor.enqueue(decision, "m");
    await new Promise((r) => setTimeout(r, 50));

    expect(transport.sends).toBe(0);
    expect(pm.get("m")?.sellState).toBe("FAILED");
  });

  test("malformed quote safety rejects invalid price impact and output bounds", async () => {
    const config = baseConfig();
    const pm = new PositionManager();
    pm.upsert(createPosition({ mint: "m", decimals: 6, walletAddress: Keypair.generate().publicKey.toBase58(), amount: 100, entryPrice: 1 }));

    const quote: Quote = {
      provider: "test",
      inAmount: 100n,
      expectedOutAmount: 90n,
      minimumOutAmount: 100n,
      priceImpactBps: Number.NaN,
      routeAvailable: true,
      routeInfo: {},
      timestamp: Date.now()
    };

    const transport = new TestTransport("confirmed");
    const executor = new SellExecutor(
      config,
      pm,
      new TestQuoteProvider(quote),
      new TestBuilder(),
      new RetryManager(config.execution),
      new PriorityFeeManager(config.execution),
      transport,
      new Logger("error"),
      Keypair.generate()
    );

    executor.enqueue(decision, "m");
    await new Promise((r) => setTimeout(r, 50));

    expect(transport.sends).toBe(0);
    expect(pm.get("m")?.sellState).toBe("FAILED");
  });

  test("future quote timestamps are rejected", async () => {
    const config = baseConfig();
    const pm = new PositionManager();
    pm.upsert(createPosition({ mint: "m", decimals: 6, walletAddress: Keypair.generate().publicKey.toBase58(), amount: 100, entryPrice: 1 }));

    const quote: Quote = {
      provider: "test",
      inAmount: 100n,
      expectedOutAmount: 90n,
      minimumOutAmount: 80n,
      priceImpactBps: 300,
      routeAvailable: true,
      routeInfo: {},
      timestamp: Date.now() + 10_000
    };

    const transport = new TestTransport("confirmed");
    const executor = new SellExecutor(
      config,
      pm,
      new TestQuoteProvider(quote),
      new TestBuilder(),
      new RetryManager(config.execution),
      new PriorityFeeManager(config.execution),
      transport,
      new Logger("error"),
      Keypair.generate()
    );

    executor.enqueue(decision, "m");
    await new Promise((r) => setTimeout(r, 50));

    expect(transport.sends).toBe(0);
    expect(pm.get("m")?.sellState).toBe("FAILED");
  });

  test("unknown confirmation status sets UNKNOWN", async () => {
    const config = baseConfig();
    const pm = new PositionManager();
    pm.upsert(createPosition({ mint: "m", decimals: 6, walletAddress: Keypair.generate().publicKey.toBase58(), amount: 100, entryPrice: 1 }));

    const quote: Quote = {
      provider: "test",
      inAmount: 100n,
      expectedOutAmount: 90n,
      minimumOutAmount: 80n,
      priceImpactBps: 300,
      routeAvailable: true,
      routeInfo: {},
      timestamp: Date.now()
    };

    const executor = new SellExecutor(
      config,
      pm,
      new TestQuoteProvider(quote),
      new TestBuilder(),
      new RetryManager(config.execution),
      new PriorityFeeManager(config.execution),
      new TestTransport("unknown"),
      new Logger("error"),
      Keypair.generate()
    );

    executor.enqueue(decision, "m");
    await new Promise((r) => setTimeout(r, 50));

    expect(pm.get("m")?.sellState).toBe("UNKNOWN");
  });

  test("unknown confirmation is reconciled before finalizing SOLD/PARTIALLY_SOLD and never retried", async () => {
    const config = baseConfig();
    const pm = new PositionManager();
    pm.upsert(createPosition({ mint: "m", decimals: 6, walletAddress: Keypair.generate().publicKey.toBase58(), amount: 100, entryPrice: 1 }));
    const quote: Quote = {
      provider: "test",
      inAmount: 100n,
      expectedOutAmount: 90n,
      minimumOutAmount: 80n,
      priceImpactBps: 300,
      routeAvailable: true,
      routeInfo: {},
      timestamp: Date.now()
    };
    const transport = new TestTransport("unknown");
    const builder = new TestBuilder();
    const reconciler = new TestReconciler("PARTIALLY_SOLD");
    const executor = new SellExecutor(
      config,
      pm,
      new TestQuoteProvider(quote),
      builder,
      new RetryManager(config.execution),
      new PriorityFeeManager(config.execution),
      transport,
      new Logger("error"),
      Keypair.generate(),
      reconciler as PositionReconciler
    );

    executor.enqueue(decision, "m");
    await new Promise((r) => setTimeout(r, 50));

    expect(reconciler.calls).toBe(1);
    expect(builder.builds).toBe(1);
    expect(transport.sends).toBe(1);
    expect(pm.get("m")?.sellState).toBe("SELLING");
  });

  test("ambiguous UNKNOWN reconciliation is fail-closed and cannot trigger a rebuild", async () => {
    const config = baseConfig();
    const pm = new PositionManager();
    pm.upsert(createPosition({ mint: "m", decimals: 6, walletAddress: Keypair.generate().publicKey.toBase58(), amount: 100, entryPrice: 1 }));
    const quote: Quote = {
      provider: "test",
      inAmount: 100n,
      expectedOutAmount: 90n,
      minimumOutAmount: 80n,
      priceImpactBps: 300,
      routeAvailable: true,
      routeInfo: {},
      timestamp: Date.now()
    };
    const transport = new TestTransport("unknown");
    const builder = new TestBuilder();
    const reconciler = new TestReconciler("AMBIGUOUS");
    const executor = new SellExecutor(
      config,
      pm,
      new TestQuoteProvider(quote),
      builder,
      new RetryManager(config.execution),
      new PriorityFeeManager(config.execution),
      transport,
      new Logger("error"),
      Keypair.generate(),
      reconciler as PositionReconciler
    );

    executor.enqueue(decision, "m");
    await new Promise((r) => setTimeout(r, 50));

    expect(reconciler.calls).toBe(1);
    expect(builder.builds).toBe(1);
    expect(transport.sends).toBe(1);
    expect(pm.get("m")?.sellState).toBe("UNKNOWN");
  });
});
