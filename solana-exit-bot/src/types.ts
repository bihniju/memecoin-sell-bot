export type Mode = "paper" | "dry-run" | "live";

export type ExitTrigger =
  | "EMERGENCY"
  | "LIQUIDITY_COLLAPSE"
  | "NO_VALID_ROUTE"
  | "RAPID_DECLINE"
  | "HARD_STOP_LOSS"
  | "TRAILING_STOP"
  | "TAKE_PROFIT";

export type SellState = "IDLE" | "SELLING" | "SOLD" | "PARTIALLY_SOLD" | "FAILED";

export interface TakeProfitLevel {
  id: string;
  profitPct: number;
  sellPct: number;
}

export interface Position {
  mint: string;
  decimals: number;
  walletAddress: string;
  amount: number;
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
}

export interface LiquiditySnapshot {
  mint: string;
  liquidityUsd: number;
  reserveBase?: number;
  reserveQuote?: number;
  timestamp: number;
}

export interface TriggerDecision {
  trigger: ExitTrigger;
  reason: string;
  timestamp: number;
  price: number;
  entryPrice: number;
  pnlPct: number;
  riskScore: number;
  sellPct: number;
}

export interface FallingSignal {
  score: number;
  shortDropPct: number;
  consecutiveLowerTicks: number;
  acceleratingDecline: boolean;
  volumeImbalance: number;
  liquidityDeterioration: number;
}

export interface Quote {
  inAmount: number;
  outAmount: number;
  priceImpactBps: number;
  routeAvailable: boolean;
  timestamp: number;
}

export interface BuiltTransaction {
  serialized: string;
  priorityFeeMicrolamports: number;
}

export interface SellExecutionResult {
  submitted: boolean;
  signature?: string;
  reason: string;
}

export interface RiskConfig {
  stopLossEnabled: boolean;
  stopLossPct: number;
  earlyExitEnabled: boolean;
  earlyExitPct: number;
  fallingMarketEnabled: boolean;
  fallingWindowMs: number;
  fallingDropPct: number;
  consecutiveLowerTicks: number;
  riskScoreWarning: number;
  riskScoreHigh: number;
  riskScoreEmergency: number;
  fallingWeightPriceDrop: number;
  fallingWeightLowerTicks: number;
  fallingWeightAcceleration: number;
  fallingWeightVolumeImbalance: number;
  fallingWeightLiquidity: number;
  trailingStopEnabled: boolean;
  trailingActivationPct: number;
  trailingStopPct: number;
  takeProfitEnabled: boolean;
  takeProfitLevels: TakeProfitLevel[];
  maxPriceImpactBps: number;
}

export interface ExecutionConfig {
  maxSellRetries: number;
  priorityFeeEnabled: boolean;
  priorityFeeMode: "dynamic" | "fixed";
  minPriorityFeeMicrolamports: number;
  maxPriorityFeeMicrolamports: number;
  emergencyPriorityFeeMicrolamports: number;
}

export interface RpcConfig {
  network: string;
  rpcEndpoints: string[];
  websocketEndpoints: string[];
  staleMarketMs: number;
}

export interface BotConfig {
  mode: Mode;
  dryRun: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
  walletKeypairPath?: string;
  risk: RiskConfig;
  execution: ExecutionConfig;
  rpc: RpcConfig;
}
