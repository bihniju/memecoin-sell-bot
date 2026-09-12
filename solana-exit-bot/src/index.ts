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
import { PositionReconciler } from "./position/PositionReconciler.js";
import { createPosition } from "./position/PositionState.js";
import { RiskEngine } from "./risk/RiskEngine.js";
import { RpcManager } from "./rpc/RpcManager.js";
import { HeliusWebSocketAdapter, SolanaWebSocketAdapter, WebSocketManager } from "./rpc/WebSocketManager.js";

const config = loadConfig();
const logger = new Logger(config.logLevel);
requireLiveTradingEnabled(config);
const staleMarketMs = config.risk.staleMarketMs ?? config.rpc.staleMarketMs;
const quoteTimeoutMs = config.execution.quoteRequestTimeoutMs ?? 900;

const wallet = loadWalletKeypair(config);
const positions = new PositionManager();
const priceMonitor = new PriceMonitor();
const liquidityMonitor = new LiquidityMonitor();
const riskEngine = new RiskEngine(config.risk);
const rpcManager = new RpcManager(config.rpc.rpcEndpoints.length ? config.rpc.rpcEndpoints : ["https://api.mainnet-beta.solana.com"], logger);
const positionReconciler = new PositionReconciler(rpcManager);

const quoteProvider: QuoteProvider = config.mode === "paper"
  ? new SimulatedQuoteProvider()
  : new JupiterQuoteProvider(config.market.quoteApiUrl, config.market.jupiterApiKey, { timeoutMs: quoteTimeoutMs, retries: config.execution.quoteRetries ?? 2, cacheMs: 100 });
const txBuilder = new JupiterSellTransactionBuilder(config.market.swapApiUrl, config.mode !== "live", config.market.jupiterApiKey, { timeoutMs: quoteTimeoutMs + 300, retries: 1 });
const transport = new SolanaTransactionTransport(rpcManager, {
  skipPreflight: config.execution.skipPreflight,
  maxRetries: config.execution.maxRpcSendRetries,
  confirmationTimeoutMs: config.execution.confirmationTimeoutMs,
  sendTimeoutMs: config.execution.rpcSendTimeoutMs ?? 1500
});
const sellExecutor = new SellExecutor(config, positions, quoteProvider, txBuilder, new RetryManager(config.execution), new PriorityFeeManager(config.execution, rpcManager), transport, logger, wallet, positionReconciler);
const normalizer = new MarketEventNormalizer(quoteProvider, priceMonitor, liquidityMonitor, config.market.sampleDebounceMs);

const mint = process.argv.includes("--mint") ? process.argv[process.argv.indexOf("--mint") + 1] : process.env.POSITION_MINT ?? "demo-mint";
const decimals = Number(process.env.POSITION_DECIMALS ?? 6);
const amount = Number(process.env.POSITION_AMOUNT ?? 1_000_000);
const amountRaw = process.env.POSITION_AMOUNT_RAW ? BigInt(process.env.POSITION_AMOUNT_RAW) : undefined;
const entryPrice = Number(process.env.POSITION_ENTRY_PRICE ?? 1);
positions.upsert(createPosition({ mint, decimals, walletAddress: wallet?.publicKey.toBase58() ?? Keypair.generate().publicKey.toBase58(), amount, amountRaw, entryPrice }));

normalizer.register({
  mint,
  outputMint: config.market.outputMint,
  sampleAmount: amountRaw ? (amountRaw / 100n > 0n ? amountRaw / 100n : 1n) : BigInt(Math.max(1, Math.floor(amount * 0.01))),
  slippageBps: config.execution.quoteSlippageBps
});

const configuredWsEndpoints = config.rpc.websocketEndpoints.filter(Boolean);
const defaultWsEndpoint = config.market.websocketProvider === "helius" ? config.rpc.heliusWsUrl ?? configuredWsEndpoints[0] : configuredWsEndpoints[0] ?? "wss://api.mainnet-beta.solana.com";
const wsEndpoints = Array.from(new Set([defaultWsEndpoint, ...configuredWsEndpoints, ...(config.rpc.heliusWsUrl ? [config.rpc.heliusWsUrl] : [])].filter(Boolean))) as string[];
const wsProvider: WebSocketManager = config.market.websocketProvider === "helius"
  ? new HeliusWebSocketAdapter(wsEndpoints, config.market.heartbeatMs, staleMarketMs)
  : new SolanaWebSocketAdapter(wsEndpoints, config.market.heartbeatMs, staleMarketMs);

const evaluateRisk = (
  positionMint: string,
  overrides: {
    hasValidRoute?: boolean;
    priceImpactBps?: number;
    emergencyFlag?: boolean;
    marketDataStale?: boolean;
    marketEventAt?: number;
  } = {}
) => {
  const position = positions.get(positionMint);
  if (!position) return;
  const decision = riskEngine.evaluate({
    position,
    prices: priceMonitor.getTicks(positionMint, config.risk.fallingWindowMs),
    liquidity: liquidityMonitor.getSnapshots(positionMint, config.risk.fallingWindowMs),
    hasValidRoute: overrides.hasValidRoute ?? true,
    priceImpactBps: overrides.priceImpactBps,
    emergencyFlag: overrides.emergencyFlag,
    marketDataStale: overrides.marketDataStale,
    rpcCongested: rpcManager.isCongested(rpcManager.getActiveEndpoint(), config.execution.congestionLatencyMs ?? 800)
  });
  if (!decision) return;
  logger.warn("risk_triggered", { mint: positionMint, trigger: decision.trigger, reason: decision.reason, riskScore: decision.riskScore });
  sellExecutor.enqueue(decision, positionMint, overrides.marketEventAt ?? Date.now());
};

priceMonitor.on("tick", (tick) => {
  const p = positions.updatePrice(tick.mint, tick.price);
  if (!p) return;
  evaluateRisk(tick.mint, { priceImpactBps: tick.priceImpactBps, marketEventAt: tick.timestamp });
});

normalizer.on("quoteUnavailable", (event) => evaluateRisk(event.mint, { hasValidRoute: false, priceImpactBps: config.risk.maxPriceImpactBps + 1 }));
normalizer.on("quoteError", (event) => logger.warn("market_quote_error", { mint: event.mint, error: event.error }));
wsProvider.on("marketEvent", (event: { receivedAt: number; mint?: string }) => { void normalizer.handleMarketEvent(event.receivedAt, event.mint); });
wsProvider.on("stale", (event?: { endpoint?: string; staleMs?: number }) => {
  const observedStaleMs = event?.staleMs ?? staleMarketMs;
  logger.warn("market_data_stale", { endpoint: event?.endpoint ?? defaultWsEndpoint, staleMs: observedStaleMs });
  if (!(config.risk.emergencyOnStaleMarket ?? true) || observedStaleMs < staleMarketMs) return;
  evaluateRisk(mint, { hasValidRoute: false, emergencyFlag: true, marketDataStale: true, marketEventAt: Date.now() - observedStaleMs });
});
wsProvider.on("error", (error) => logger.warn("market_ws_error", { error: String(error) }));

const shutdown = async () => { await wsProvider.disconnect(); process.exit(0); };
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

logger.info("Exit bot started", { mode: config.mode, dryRun: config.dryRun, mint, websocketProvider: config.market.websocketProvider, wsEndpoints, rpcEndpoint: rpcManager.getActiveEndpoint() });

if (config.mode === "paper") {
  const synthetic = [1.01, 1.0, 0.99, 0.98, 0.97, 0.95, 0.93];
  for (const [i, price] of synthetic.entries()) {
    setTimeout(() => {
      const timestamp = Date.now();
      void normalizer.handleMarketEvent(timestamp, mint);
      priceMonitor.ingest({ mint, price, timestamp, volumeBuy: 50 - i * 4, volumeSell: 50 + i * 8 });
      liquidityMonitor.ingest({ mint, liquidityUsd: 100000 - i * 8000, timestamp });
    }, i * 250);
  }
} else {
  void wsProvider.connect().then(() => wsProvider.subscribe(`mint:${mint}`)).catch((error) => logger.error("ws_start_failed", { error: String(error) }));
}
