import { LiquiditySnapshot, Position, PriceTick, RiskConfig, TriggerDecision } from "../types.js";
import { pctChange } from "../utils/math.js";
import { FallingMarketDetector } from "./FallingMarketDetector.js";
import { shouldTriggerStopLoss } from "./StopLoss.js";
import { nextTakeProfitTrigger } from "./TakeProfit.js";
import { shouldTriggerTrailingStop } from "./TrailingStop.js";

const priority: Array<TriggerDecision["trigger"]> = [
  "EMERGENCY",
  "LIQUIDITY_COLLAPSE",
  "NO_VALID_ROUTE",
  "RAPID_DECLINE",
  "HARD_STOP_LOSS",
  "TRAILING_STOP",
  "TAKE_PROFIT"
];

export interface RiskInput {
  position: Position;
  prices: PriceTick[];
  liquidity: LiquiditySnapshot[];
  hasValidRoute: boolean;
  priceImpactBps?: number;
  emergencyFlag?: boolean;
  marketDataStale?: boolean;
  rpcCongested?: boolean;
}

export class RiskEngine {
  private readonly fallingDetector: FallingMarketDetector;
  private readonly recentTriggers = new Map<string, number>();

  constructor(private readonly config: RiskConfig) {
    this.fallingDetector = new FallingMarketDetector(config);
  }

  evaluate(input: RiskInput): TriggerDecision | undefined {
    const { position, prices, liquidity, hasValidRoute, priceImpactBps, emergencyFlag, marketDataStale, rpcCongested } = input;
    const fallingSignal = this.fallingDetector.evaluate(prices, liquidity);
    const decisions: TriggerDecision[] = [];

    if (emergencyFlag || (marketDataStale && this.config.emergencyOnStaleMarket) || (rpcCongested && this.config.emergencyOnCongestion)) {
      const reasons = [
        emergencyFlag ? "external emergency" : "",
        marketDataStale && this.config.emergencyOnStaleMarket ? "market data stale" : "",
        rpcCongested && this.config.emergencyOnCongestion ? "RPC congested" : ""
      ].filter(Boolean).join(", ");
      decisions.push(this.make(position, "EMERGENCY", `Emergency exit: ${reasons}`, 100, 100));
    }

    if (!hasValidRoute) {
      decisions.push(this.make(position, "NO_VALID_ROUTE", "No executable route available", fallingSignal.score, 100));
    }

    if (typeof priceImpactBps === "number" && priceImpactBps > this.config.maxPriceImpactBps) {
      decisions.push(this.make(position, "LIQUIDITY_COLLAPSE", `Price impact ${priceImpactBps}bps exceeds max`, fallingSignal.score, 100));
    }

    if (this.config.fallingMarketEnabled && fallingSignal.score >= this.config.riskScoreEmergency) {
      decisions.push(this.make(position, "RAPID_DECLINE", `Risk score ${fallingSignal.score}`, fallingSignal.score, 100));
    } else if (
      this.config.earlyExitEnabled && this.config.fallingMarketEnabled &&
      (fallingSignal.score >= this.config.riskScoreHigh || fallingSignal.shortDropPct >= this.config.earlyExitPct)
    ) {
      decisions.push(this.make(position, "RAPID_DECLINE", `Early decline score ${fallingSignal.score}`, fallingSignal.score, 100));
    }

    if (this.config.stopLossEnabled && shouldTriggerStopLoss(position, this.config.stopLossPct)) {
      decisions.push(this.make(position, "HARD_STOP_LOSS", `Stop loss ${this.config.stopLossPct}% reached`, fallingSignal.score, 100));
    }

    if (this.config.trailingStopEnabled && shouldTriggerTrailingStop(position, this.config.trailingActivationPct, this.config.trailingStopPct)) {
      decisions.push(this.make(position, "TRAILING_STOP", "Trailing stop triggered", fallingSignal.score, 100));
    }

    if (this.config.takeProfitEnabled) {
      const tp = nextTakeProfitTrigger(position, this.config.takeProfitLevels);
      if (tp) decisions.push(this.make(position, "TAKE_PROFIT", `Take profit ${tp.level.id} reached at ${tp.currentProfitPct.toFixed(2)}%`, fallingSignal.score, tp.level.sellPct));
    }

    if (decisions.length === 0) return;
    decisions.sort((a, b) => priority.indexOf(a.trigger) - priority.indexOf(b.trigger));
    const selected = decisions[0];
    const key = `${position.mint}:${selected.trigger}`;
    const previous = this.recentTriggers.get(key);
    if (previous && Date.now() - previous < this.config.decisionCooldownMs) return;
    this.recentTriggers.set(key, Date.now());
    return selected;
  }

  private make(position: Position, trigger: TriggerDecision["trigger"], reason: string, riskScore: number, sellPct: number): TriggerDecision {
    return {
      trigger,
      reason,
      timestamp: Date.now(),
      price: position.currentPrice,
      entryPrice: position.entryPrice,
      pnlPct: pctChange(position.entryPrice, position.currentPrice),
      riskScore,
      sellPct
    };
  }
}
