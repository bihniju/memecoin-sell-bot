import { Keypair } from "@solana/web3.js";
import { loadConfig } from "./config.js";
import { PriorityFeeManager } from "./execution/PriorityFeeManager.js";
import { JupiterQuoteProvider, QuoteProvider, SimulatedQuoteProvider } from "./execution/QuoteProvider.js";
import { RetryManager } from "./execution/RetryManager.js";
import { SellExecutor } from "./execution/SellExecutor.js";
import { SolanaTransactionTransport } from "./execution/TransactionTransport.js";
import { JupiterSellTransactionBuilder } from "./execution/TransactionBuilder.js";
import { loadWalletKeypair, requireLiveTradingEnabled } from "./execution/WalletLoader.js";
import { Logger } from "./logging/Logger.js";
import { LiquidityMonitor } from "./market/LiquidityMonitor.js";
import { MarketEventNormalizer } from "./market/MarketEventNormalizer.js";
import { PriceMonitor } from "./market/PriceMonitor.js";
import { PositionManager } from "./position/PositionManager.js";
import { createPosition } from "./position/PositionState.js";
import { RiskEngine } from "./risk/RiskEngine.js";
import { RpcManager } from "./rpc/RpcManager.js";
import { HeliusWebSocketAdapter, SolanaWebSocketAdapter, WebSocketManager } from "./rpc/WebSocketManager.js";

const config = loadConfig();
const logger = new Logger(config.logLevel);

requireLiveTradingEnabled(config);

const wallet = loadWalletKeypair(config);
const positions = new PositionManager();
const priceMonitor = new PriceMonitor();
const liquidityMonitor = new LiquidityMonitor();
const riskEngine = new RiskEngine(config.risk);

const rpcManager = new RpcManager(
  config.rpc.rpcEndpoints.length ? config.rpc.rpcEndpoints : ["https://api.mainnet-beta.solana.com"],
  logger
);

const quoteProvider: QuoteProvider = config.mode === "paper" ? new SimulatedQuoteProvider() : new JupiterQuoteProvider(config.market.quoteApiUrl);
const txBuilder = new JupiterSellTransactionBuilder(config.market.swapApiUrl, config.mode !== "live");
const transport = new SolanaTransactionTransport(rpcManager, {
  skipPreflight: config.execution.skipPreflight,
  maxRetries: config.execution.maxRpcSendRetries,
  confirmationTimeoutMs: config.execution.confirmationTimeoutMs
});

const sellExecutor = new SellExecutor(
  config,
  positions,
  quoteProvider,
  txBuilder,
  new RetryManager(config.execution),
  new PriorityFeeManager(config.execution, rpcManager),
  transport,
  logger,
  wallet
);

const normalizer = new MarketEventNormalizer(
  quoteProvider,
  priceMonitor,
  liquidityMonitor,
  config.market.sampleDebounceMs
);

const mint = process.argv.includes("--mint") ? process.argv[process.argv.indexOf("--mint") + 1] : process.env.POSITION_MINT ?? "demo-mint";
const decimals = Number(process.env.POSITION_DECIMALS ?? 6);
const amount = Number(process.env.POSITION_AMOUNT ?? 1_000_000);
const entryPrice = Number(process.env.POSITION_ENTRY_PRICE ?? 1);

positions.upsert(
  createPosition({
    mint,
    decimals,
    walletAddress: wallet?.publicKey.toBase58() ?? Keypair.generate().publicKey.toBase58(),
    amount,
    entryPrice
  })
);

normalizer.register({
  mint,
  outputMint: config.market.outputMint,
  sampleAmount: BigInt(Math.max(1, Math.floor(amount * 0.01))),
  slippageBps: config.execution.quoteSlippageBps
});

const wsEndpoint =
  config.market.websocketProvider === "helius"
    ? config.rpc.heliusWsUrl ?? config.rpc.websocketEndpoints[0]
    : config.rpc.websocketEndpoints[0] ?? "wss://api.mainnet-beta.solana.com";

const wsProvider: WebSocketManager =
  config.market.websocketProvider === "helius"
    ? new HeliusWebSocketAdapter(wsEndpoint, config.market.heartbeatMs, config.rpc.staleMarketMs)
    : new SolanaWebSocketAdapter(wsEndpoint, config.market.heartbeatMs, config.rpc.staleMarketMs);

priceMonitor.on("tick", (tick) => {
  const p = positions.updatePrice(tick.mint, tick.price);
  if (!p) return;

  const prices = priceMonitor.getTicks(tick.mint, config.risk.fallingWindowMs);
  const liquidity = liquidityMonitor.getSnapshots(tick.mint, config.risk.fallingWindowMs);
  const decision = riskEngine.evaluate({
    position: p,
    prices,
    liquidity,
    hasValidRoute: true,
    priceImpactBps: 0
  });

  if (!decision) return;

  logger.warn("risk_triggered", {
    mint: tick.mint,
    trigger: decision.trigger,
    reason: decision.reason,
    riskScore: decision.riskScore
  });
  sellExecutor.enqueue(decision, tick.mint, tick.timestamp);
});

normalizer.on("quoteUnavailable", (event) => {
  const p = positions.get(event.mint);
  if (!p) return;
  const decision = riskEngine.evaluate({
    position: p,
    prices: priceMonitor.getTicks(event.mint, config.risk.fallingWindowMs),
    liquidity: liquidityMonitor.getSnapshots(event.mint, config.risk.fallingWindowMs),
    hasValidRoute: false,
    priceImpactBps: config.risk.maxPriceImpactBps + 1
  });
  if (decision) {
    sellExecutor.enqueue(decision, event.mint, event.marketEventAt);
  }
});

wsProvider.on("marketEvent", (event: { receivedAt: number }) => {
  void normalizer.handleMarketEvent(event.receivedAt);
});

wsProvider.on("stale", () => {
  logger.warn("market_data_stale", { endpoint: wsEndpoint, staleMs: config.rpc.staleMarketMs });
});

const shutdown = async () => {
  await wsProvider.disconnect();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

logger.info("Exit bot started", {
  mode: config.mode,
  dryRun: config.dryRun,
  mint,
  websocketProvider: config.market.websocketProvider,
  wsEndpoint,
  rpcEndpoint: rpcManager.getActiveEndpoint()
});

if (config.mode === "paper") {
  const synthetic = [1.01, 1.0, 0.99, 0.98, 0.97, 0.95, 0.93];
  for (const [i, price] of synthetic.entries()) {
    setTimeout(() => {
      void normalizer.handleMarketEvent(Date.now());
      priceMonitor.ingest({ mint, price, timestamp: Date.now(), volumeBuy: 50 - i * 4, volumeSell: 50 + i * 8 });
      liquidityMonitor.ingest({ mint, liquidityUsd: 100000 - i * 8000, timestamp: Date.now() });
    }, i * 250);
  }
} else {
  void wsProvider
    .connect()
    .then(() => wsProvider.subscribe(`mint:${mint}`))
    .catch((error) => {
      logger.error("ws_start_failed", { error: String(error) });
      process.exit(1);
    });
}
