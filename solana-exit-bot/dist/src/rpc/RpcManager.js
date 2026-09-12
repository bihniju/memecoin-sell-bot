export class RpcManager {
    endpoints;
    logger;
    health = new Map();
    activeEndpoint;
    constructor(endpoints, logger) {
        this.endpoints = endpoints;
        this.logger = logger;
        if (endpoints.length === 0)
            throw new Error("At least one RPC endpoint is required");
        this.activeEndpoint = endpoints[0];
        for (const endpoint of endpoints) {
            this.health.set(endpoint, { endpoint, healthy: true, latencyMs: Number.MAX_SAFE_INTEGER, cooldownUntil: 0 });
        }
    }
    getActiveEndpoint() {
        return this.activeEndpoint;
    }
    async recordHealthCheck(endpoint, latencyMs, healthy) {
        const state = this.health.get(endpoint);
        if (!state)
            return;
        state.healthy = healthy;
        state.latencyMs = latencyMs;
        state.cooldownUntil = healthy ? 0 : Date.now() + 5_000;
        if (!healthy && endpoint === this.activeEndpoint) {
            this.failover();
        }
        if (healthy && endpoint === this.endpoints[0]) {
            this.activeEndpoint = endpoint;
        }
    }
    failover() {
        const now = Date.now();
        const candidates = [...this.health.values()]
            .filter((e) => e.healthy && e.cooldownUntil <= now)
            .sort((a, b) => a.latencyMs - b.latencyMs);
        if (candidates.length > 0) {
            this.activeEndpoint = candidates[0].endpoint;
            this.logger.warn("RPC failover", { endpoint: this.activeEndpoint });
            return this.activeEndpoint;
        }
        return this.activeEndpoint;
    }
}
