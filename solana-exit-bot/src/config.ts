import dotenv from "dotenv";
import { BotConfig, Mode, TakeProfitLevel } from "./types.js";

dotenv.config();

const bool = (v: string | undefined, fallback: boolean): boolean => {
  if (v === undefined) return fallback;
  return v.toLowerCase() === "true";
};

const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const arr = (...vals: Array<string | undefined>): string[] => vals.filter((v): v is string => Boolean(v && v.trim()));

const DEFAULT_SOL_MINT = "So11111111111111111111111111111111111111112";

export const loadConfig = (): BotConfig => {
  const mode = (process.env.MODE as Mode | undefined) ?? "paper";
  const takeProfitLevels: TakeProfitLevel[] = [
    { id: "tp1", profitPct: num(process.env.TAKE_PROFIT_1_PCT, 20), sellPct: num(process.env.TAKE_PROFIT_1_SELL_PCT, 25) },
    { id: "tp2", profitPct: num(process.env.TAKE_PROFIT_2_PCT, 40), sellPct: num(process.env.TAKE_PROFIT_2_SELL_PCT, 25) }
  ];

  return {
    mode,
    dryRun: bool(process.env.DRY_RUN, mode !== "live"),
    logLevel: (process.env.LOG_LEVEL as BotConfig["logLevel"]) ?? "info",
    risk: {
      stopLossEnabled: bool(process.env.STOP_LOSS_ENABLED, true),
      stopLossPct: num(process.env.STOP_LOSS_PCT, 5),
      earlyExitEnabled: bool(process.env.EARLY_EXIT_ENABLED, true),
      earlyExitPct: num(process.env.EARLY_EXIT_PCT, 2),
      fallingMarketEnabled: bool(process.env.FALLING_MARKET_ENABLED, true),
      fallingWindowMs: num(process.env.FALLING_WINDOW_MS, 3000),
      fallingDropPct: num(process.env.FALLING_DROP_PCT, 1.5),
      consecutiveLowerTicks: num(process.env.CONSECUTIVE_LOWER_TICKS, 3),
      riskScoreWarning: num(process.env.RISK_SCORE_WARNING, 40),
      riskScoreHigh: num(process.env.RISK_SCORE_HIGH, 60),
      riskScoreEmergency: num(process.env.RISK_SCORE_EMERGENCY, 80),
      fallingWeightPriceDrop: num(process.env.FALLING_WEIGHT_PRICE_DROP, 40),
      fallingWeightLowerTicks: num(process.env.FALLING_WEIGHT_LOWER_TICKS, 20),
      fallingWeightAcceleration: num(process.env.FALLING_WEIGHT_ACCELERATION, 20),
      fallingWeightVolumeImbalance: num(process.env.FALLING_WEIGHT_VOLUME_IMBALANCE, 10),
      fallingWeightLiquidity: num(process.env.FALLING_WEIGHT_LIQUIDITY, 10),
      trailingStopEnabled: bool(process.env.TRAILING_STOP_ENABLED, true),
      trailingActivationPct: num(process.env.TRAILING_ACTIVATION_PCT, 20),
      trailingStopPct: num(process.env.TRAILING_STOP_PCT, 8),
      takeProfitEnabled: bool(process.env.TAKE_PROFIT_ENABLED, true),
      takeProfitLevels,
      maxPriceImpactBps: num(process.env.MAX_PRICE_IMPACT_BPS, 1500),
      decisionCooldownMs: num(process.env.DECISION_COOLDOWN_MS, 500)
    },
    execution: {
      maxSellRetries: num(process.env.MAX_SELL_RETRIES, 3),
      priorityFeeEnabled: bool(process.env.PRIORITY_FEE_ENABLED, true),
      priorityFeeMode: (process.env.PRIORITY_FEE_MODE as "dynamic" | "fixed" | "emergency") ?? "dynamic",
      minPriorityFeeMicrolamports: num(process.env.MIN_PRIORITY_FEE_MICROLAMPORTS, 1000),
      maxPriorityFeeMicrolamports: num(process.env.MAX_PRIORITY_FEE_MICROLAMPORTS, 50000),
      emergencyPriorityFeeMicrolamports: num(process.env.EMERGENCY_PRIORITY_FEE_MICROLAMPORTS, 100000),
      quoteSlippageBps: num(process.env.QUOTE_SLIPPAGE_BPS, 250),
      quoteStaleMs: num(process.env.QUOTE_STALE_MS, 1500),
      skipPreflight: bool(process.env.SKIP_PREFLIGHT, false),
      maxRpcSendRetries: num(process.env.RPC_MAX_RETRIES, 2),
      confirmationTimeoutMs: num(process.env.CONFIRMATION_TIMEOUT_MS, 30_000),
      simulationLatencyMs: num(process.env.SIMULATION_LATENCY_MS, 50)
    },
    rpc: {
      network: process.env.NETWORK ?? "mainnet-beta",
      rpcEndpoints: arr(process.env.RPC_ENDPOINT, process.env.RPC_ENDPOINT_2, process.env.RPC_ENDPOINT_3),
      websocketEndpoints: arr(process.env.WEBSOCKET_ENDPOINT, process.env.WEBSOCKET_ENDPOINT_2),
      staleMarketMs: num(process.env.STALE_MARKET_MS, 1500),
      heliusApiKey: process.env.HELIUS_API_KEY,
      heliusRpcUrl: process.env.HELIUS_RPC_URL,
      heliusWsUrl: process.env.HELIUS_WS_URL
    },
    wallet: {
      walletKeypairPath: process.env.WALLET_KEYPAIR_PATH,
      liveTradingEnabled: bool(process.env.LIVE_TRADING_ENABLED, false)
    },
    market: {
      outputMint: process.env.OUTPUT_MINT ?? DEFAULT_SOL_MINT,
      quoteApiUrl: process.env.QUOTE_API_URL ?? "https://api.jup.ag/swap/v1/quote",
      swapApiUrl: process.env.SWAP_API_URL ?? "https://api.jup.ag/swap/v1/swap",
      jupiterApiKey: process.env.JUPITER_API_KEY,
      websocketProvider: (process.env.WEBSOCKET_PROVIDER as "solana" | "helius") ?? "solana",
      sampleDebounceMs: num(process.env.SAMPLE_DEBOUNCE_MS, 150),
      heartbeatMs: num(process.env.WS_HEARTBEAT_MS, 15_000)
    }
  };
};
