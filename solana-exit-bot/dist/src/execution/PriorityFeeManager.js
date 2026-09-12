import { clamp } from "../utils/math.js";
export class PriorityFeeManager {
    config;
    source;
    constructor(config, source) {
        this.config = config;
        this.source = source;
    }
    async resolveFee(decision, attempt, emergencyRequested = false) {
        if (!this.config.priorityFeeEnabled)
            return 0;
        if (emergencyRequested || this.config.priorityFeeMode === "emergency" || decision.trigger === "EMERGENCY") {
            return this.config.emergencyPriorityFeeMicrolamports;
        }
        if (this.config.priorityFeeMode === "fixed") {
            return this.config.minPriorityFeeMicrolamports;
        }
        const sampled = await this.source?.getRecentPriorityFeeMicrolamports();
        const scoreFactor = clamp(decision.riskScore / 100, 0, 1);
        const retryFactor = clamp((attempt - 1) / Math.max(1, this.config.maxSellRetries - 1), 0, 1);
        const dynamicFloor = sampled ? clamp(sampled, this.config.minPriorityFeeMicrolamports, this.config.maxPriorityFeeMicrolamports) : 0;
        const weighted = Math.round(this.config.minPriorityFeeMicrolamports +
            Math.max(scoreFactor, retryFactor) * (this.config.maxPriorityFeeMicrolamports - this.config.minPriorityFeeMicrolamports));
        return clamp(Math.max(dynamicFloor, weighted), this.config.minPriorityFeeMicrolamports, this.config.maxPriorityFeeMicrolamports);
    }
}
