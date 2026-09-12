import { Keypair } from "@solana/web3.js";
import { SimulatedQuoteProvider } from "./execution/QuoteProvider.js";
import { SolanaTransactionTransport } from "./execution/TransactionTransport.js";
import { JupiterSellTransactionBuilder } from "./execution/TransactionBuilder.js";
import { LiquidityMonitor } from "./market/LiquidityMonitor.js";
import { MarketEventNormalizer } from "./market/MarketEventNormalizer.js";
import { PriceMonitor } from "./market/PriceMonitor.js";
import { createPosition } from "./position/PositionState.js";
import { RiskEngine } from "./risk/RiskEngine.js";

const measure = async (label: string, fn: () => Promise<void>): Promise<number> => {
  const start = performance.now();
  await fn();
  const elapsed = Math.round(performance.now() - start);
  process.stdout.write(`${label.padEnd(20)} ${elapsed}ms\n`);
  return elapsed;
};

const run = async (): Promise<void> => {
  const quoteProvider = new SimulatedQuoteProvider();
  const priceMonitor = new PriceMonitor();
  const liquidityMonitor = new LiquidityMonitor();
  const normalizer = new MarketEventNormalizer(quoteProvider, priceMonitor, liquidityMonitor, 1);

  normalizer.register({
    mint: "bench-mint",
    outputMint: "So11111111111111111111111111111111111111112",
    sampleAmount: 1_000_000n,
    slippageBps: 250
  });

  const marketEvent = await measure("Market event:", async () => {
    await normalizer.handleMarketEvent(Date.now());
  });

  const riskEngine = new RiskEngine({
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
    decisionCooldownMs: 100
  });

  const position = createPosition({
    mint: "bench-mint",
    decimals: 6,
    walletAddress: Keypair.generate().publicKey.toBase58(),
    amount: 1_000_000,
    entryPrice: 1
  });
  position.currentPrice = 0.95;

  const riskEval = await measure("Risk evaluation:", async () => {
    riskEngine.evaluate({
      position,
      prices: [
        { mint: "bench-mint", price: 1, timestamp: Date.now() - 3, volumeBuy: 10, volumeSell: 20 },
        { mint: "bench-mint", price: 0.97, timestamp: Date.now() - 2, volumeBuy: 9, volumeSell: 22 },
        { mint: "bench-mint", price: 0.95, timestamp: Date.now() - 1, volumeBuy: 8, volumeSell: 24 }
      ],
      liquidity: [
        { mint: "bench-mint", liquidityUsd: 100000, timestamp: Date.now() - 3 },
        { mint: "bench-mint", liquidityUsd: 90000, timestamp: Date.now() - 1 }
      ],
      hasValidRoute: true,
      priceImpactBps: 300
    });
  });

  const quote = await measure("Quote:", async () => {
    await quoteProvider.quoteForPosition(position, "So11111111111111111111111111111111111111112", 100, 250);
  });

  const builder = new JupiterSellTransactionBuilder("https://quote-api.jup.ag/v6/swap", true);
  const sampledQuote = await quoteProvider.quoteForPosition(position, "So11111111111111111111111111111111111111112", 100, 250);

  const builtResult = { built: undefined as Awaited<ReturnType<typeof builder.buildSellTransaction>> | undefined };
  const build = await measure("Transaction build:", async () => {
    builtResult.built = await builder.buildSellTransaction({
      wallet: Keypair.generate().publicKey,
      position,
      quote: sampledQuote,
      priorityFeeMicrolamports: 2000
    });
  });

  const fakeConnection = {
    rpcEndpoint: "http://benchmark",
    async sendRawTransaction() {
      return "bench-sig";
    },
    async getSignatureStatus() {
      return { value: { err: null, confirmationStatus: "confirmed" } };
    }
  };
  const fakeRpcManager = {
    getActiveEndpoint: () => "http://benchmark",
    getActiveConnection: () => fakeConnection,
    getEndpointsInPriorityOrder: () => ["http://benchmark"],
    getConnection: () => fakeConnection,
    reportEndpointFailure: () => {}
  };

  const transport = new SolanaTransactionTransport(fakeRpcManager as never, {
    skipPreflight: false,
    maxRetries: 1,
    confirmationTimeoutMs: 1000
  });

  let signature = "";
  const submission = await measure("Submission:", async () => {
    const sent = await transport.send(builtResult.built!);
    signature = sent.signature;
  });

  const confirmation = await measure("Confirmation:", async () => {
    await transport.confirm(signature);
  });

  const total = marketEvent + riskEval + quote + build + submission + confirmation;
  process.stdout.write(`\nTotal:${" ".repeat(13)} ${total}ms\n`);
};

void run();
