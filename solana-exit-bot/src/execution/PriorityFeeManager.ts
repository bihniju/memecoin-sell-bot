import { ExecutionConfig, TriggerDecision } from "../types.js";
import { clamp } from "../utils/math.js";

export class PriorityFeeManager {
  constructor(private readonly config: ExecutionConfig) {}

  resolveFee(decision: TriggerDecision, attempt: number): number {
    if (!this.config.priorityFeeEnabled) return 0;
    if (decision.trigger === "EMERGENCY" || attempt >= this.config.maxSellRetries) {
      return this.config.emergencyPriorityFeeMicrolamports;
    }

    if (this.config.priorityFeeMode === "fixed") {
      return this.config.minPriorityFeeMicrolamports;
    }

    const scoreFactor = clamp(decision.riskScore / 100, 0, 1);
    const retryFactor = clamp((attempt - 1) / Math.max(1, this.config.maxSellRetries - 1), 0, 1);
    const factor = Math.max(scoreFactor, retryFactor);

    return Math.round(
      this.config.minPriorityFeeMicrolamports +
        factor * (this.config.maxPriorityFeeMicrolamports - this.config.minPriorityFeeMicrolamports)
    );
  }
}
