import { loadConfig } from "./config.js";
import { InMemoryTransport, SellExecutor } from "./execution/SellExecutor.js";
import { PriorityFeeManager } from "./execution/PriorityFeeManager.js";
import { StaticQuoteProvider } from "./execution/QuoteProvider.js";
import { RetryManager } from "./execution/RetryManager.js";
import { TransactionBuilder } from "./execution/TransactionBuilder.js";
import { Logger } from "./logging/Logger.js";
import { LiquidityMonitor } from "./market/LiquidityMonitor.js";
import { PriceMonitor } from "./market/PriceMonitor.js";
import { createPosition } from "./position/PositionState.js";
import { PositionManager } from "./position/PositionManager.js";
import { RiskEngine } from "./risk/RiskEngine.js";

const config = loadConfig();
const logger = new Logger(config.logLevel);

const positions = new PositionManager();
const priceMonitor = new PriceMonitor();
const liquidityMonitor = new LiquidityMonitor();
const riskEngine = new RiskEngine(config.risk);

const sellExecutor = new SellExecutor(
  config,
  positions,
  new StaticQuoteProvider(),
  new TransactionBuilder(),
  new RetryManager(config.execution),
  new PriorityFeeManager(config.execution),
  new InMemoryTransport(),
  logger
);

const mint = process.argv.includes("--mint") ? process.argv[process.argv.indexOf("--mint") + 1] : "demo-mint";
const position = createPosition({
  mint,
  decimals: 6,
  walletAddress: "wallet-demo",
  amount: 1_000_000,
  entryPrice: 1
});
positions.upsert(position);

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
    priceImpactBps: 300
  });

  logger.info("[PRICE]", {
    mint: tick.mint,
    entry: p.entryPrice,
    current: p.currentPrice,
    changePct: ((p.currentPrice - p.entryPrice) / p.entryPrice) * 100
  });

  if (decision) {
    logger.warn("[TRIGGER]", decision);
    if (decision.trigger === "TAKE_PROFIT") {
      const level = config.risk.takeProfitLevels.find((l) => decision.reason.includes(l.id));
      if (level) positions.markTakeProfitCompleted(tick.mint, level.id);
    }
    sellExecutor.enqueue(decision, tick.mint);
  }
});

logger.info("Exit bot started", { mode: config.mode, dryRun: config.dryRun, mint });

if (config.mode === "paper" || config.dryRun) {
  const synthetic = [1.01, 1.0, 0.99, 0.98, 0.97, 0.95, 0.93];
  synthetic.forEach((price, i) => {
    setTimeout(() => {
      priceMonitor.ingest({ mint, price, timestamp: Date.now(), volumeBuy: 50 - i * 4, volumeSell: 50 + i * 8 });
      liquidityMonitor.ingest({ mint, liquidityUsd: 100000 - i * 8000, timestamp: Date.now() });
    }, i * 250);
  });
}
