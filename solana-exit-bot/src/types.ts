import { VersionedTransaction } from "@solana/web3.js";

export type Mode = "paper" | "dry-run" | "live";

export type ExitTrigger =
  | "EMERGENCY"
  | "LIQUIDITY_COLLAPSE"
  | "NO_VALID_ROUTE"
  | "RAPID_DECLINE"
  | "HARD_STOP_LOSS"
  | "TRAILING_STOP"
  | "TAKE_PROFIT";

export type SellState = "IDLE" | "SELLING" | "SOLD" | "PARTIALLY_SOLD" | "FAILED" | "UNKNOWN";

export interface TakeProfitLevel { id: string; profitPct: number; sellPct: number; }

export interface Position {
  mint: string;
  decimals: number;
  walletAddress: string;
  /** Human-readable token amount for PnL/risk calculations. */
  amount: number;
  /** Exact on-chain token amount. Prefer this for every swap/quote operation. */
  amountRaw?: bigint;
  entryPrice: number;
  entryValue: number;
  entryTimestamp: number;
  currentPrice: number;
  highestPrice: number;
  lowestPrice: number;
  realizedPnL: number;
  unrealizedPnL: number;
  remainingPercentage: number;
  sellState: SellState;
  lastTrigger?: ExitTrigger;
  lastSellAttempt?: number;
  sellSignature?: string;
  completedTakeProfitLevels: Set<string>;
}

export interface PriceTick {
  mint: string;
  price: number;
  timestamp: number;
  volumeBuy?: number;
  volumeSell?: number;
  priceImpactBps?: number;
  slot?: number;
  source?: string;
}
export interface LiquiditySnapshot { mint: string; liquidityUsd: number; reserveBase?: number; reserveQuote?: number; timestamp: number; }
export interface TriggerDecision { trigger: ExitTrigger; reason: string; timestamp: number; price: number; entryPrice: number; pnlPct: number; riskScore: number; sellPct: number; }
export interface FallingSignal { score: number; shortDropPct: number; consecutiveLowerTicks: number; acceleratingDecline: boolean; volumeImbalance: number; liquidityDeterioration: number; }

export interface QuoteRequest { inputMint: string; outputMint: string; amount: bigint; slippageBps: number; onlyDirectRoutes?: boolean; }
export interface Quote {
  provider: string;
  inAmount: bigint;
  expectedOutAmount: bigint;
  minimumOutAmount: bigint;
  priceImpactBps: number;
  routeAvailable: boolean;
  routeInfo: unknown;
  timestamp: number;
}

export interface BuiltTransaction { serialized: Uint8Array; transaction?: VersionedTransaction; priorityFeeMicrolamports: number; minOutAmount: bigint; }
export type ConfirmationStatus = "confirmed" | "failed" | "unknown";
export interface SellExecutionResult { submitted: boolean; signature?: string; reason: string; status?: ConfirmationStatus; }

export interface RiskConfig {
  stopLossEnabled: boolean; stopLossPct: number; earlyExitEnabled: boolean; earlyExitPct: number;
  fallingMarketEnabled: boolean; fallingWindowMs: number; fallingDropPct: number; consecutiveLowerTicks: number;
  riskScoreWarning: number; riskScoreHigh: number; riskScoreEmergency: number; fallingWeightPriceDrop: number;
  fallingWeightLowerTicks: number; fallingWeightAcceleration: number; fallingWeightVolumeImbalance: number;
  fallingWeightLiquidity: number; trailingStopEnabled: boolean; trailingActivationPct: number; trailingStopPct: number;
  takeProfitEnabled: boolean; takeProfitLevels: TakeProfitLevel[]; maxPriceImpactBps: number; decisionCooldownMs: number;
  emergencyOnStaleMarket: boolean; staleMarketMs: number; emergencyOnCongestion: boolean;
}

export interface ExecutionConfig {
  maxSellRetries: number; priorityFeeEnabled: boolean; priorityFeeMode: "dynamic" | "fixed" | "emergency";
  minPriorityFeeMicrolamports: number; maxPriorityFeeMicrolamports: number; emergencyPriorityFeeMicrolamports: number;
  quoteSlippageBps: number; quoteStaleMs: number; skipPreflight: boolean; maxRpcSendRetries: number;
  confirmationTimeoutMs: number; simulationLatencyMs: number; quoteRequestTimeoutMs: number; quoteRetries: number;
  congestionRetryDelayMs: number; congestionLatencyMs: number;
}

export interface RpcConfig {
  network: string; rpcEndpoints: string[]; websocketEndpoints: string[]; staleMarketMs: number;
  heliusApiKey?: string; heliusRpcUrl?: string; heliusWsUrl?: string;
  healthCheckIntervalMs: number; endpointCooldownMs: number;
}
export interface WalletConfig { walletKeypairPath?: string; liveTradingEnabled: boolean; }
export interface MarketConfig {
  outputMint: string; quoteApiUrl: string; swapApiUrl: string; jupiterApiKey?: string;
  websocketProvider: "solana" | "helius"; sampleDebounceMs: number; heartbeatMs: number;
}
export interface BotConfig { mode: Mode; dryRun: boolean; logLevel: "debug" | "info" | "warn" | "error"; risk: RiskConfig; execution: ExecutionConfig; rpc: RpcConfig; wallet: WalletConfig; market: MarketConfig; }
export interface ExitLatencyTimestamps {
  marketEventAt: number; riskDecisionAt: number; quoteRequestedAt: number; quoteReceivedAt: number; transactionBuiltAt: number;
  transactionSignedAt?: number; transactionSubmittedAt?: number; confirmationAt?: number;
}
