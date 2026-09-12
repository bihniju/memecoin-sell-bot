import { Connection } from "@solana/web3.js";
export class RpcManager {
    endpoints;
    logger;
    health = new Map();
    connections = new Map();
    activeEndpoint;
    constructor(endpoints, logger) {
        this.endpoints = endpoints;
        this.logger = logger;
        if (endpoints.length === 0)
            throw new Error("At least one RPC endpoint is required");
        this.activeEndpoint = endpoints[0];
        for (const endpoint of endpoints) {
            this.health.set(endpoint, { endpoint, healthy: true, latencyMs: Number.MAX_SAFE_INTEGER, cooldownUntil: 0 });
            this.connections.set(endpoint, new Connection(endpoint, "confirmed"));
        }
    }
    getActiveEndpoint() {
        return this.activeEndpoint;
    }
    getActiveConnection() {
        return this.getConnection(this.activeEndpoint);
    }
    getConnection(endpoint) {
        const connection = this.connections.get(endpoint);
        if (!connection) {
            throw new Error(`Unknown RPC endpoint: ${endpoint}`);
        }
        return connection;
    }
    getEndpointsInPriorityOrder() {
        const now = Date.now();
        return [...this.health.values()]
            .filter((x) => x.cooldownUntil <= now)
            .sort((a, b) => Number(a.healthy) * -1 - Number(b.healthy) * -1 || a.latencyMs - b.latencyMs)
            .map((x) => x.endpoint);
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
    reportEndpointFailure(endpoint) {
        const state = this.health.get(endpoint);
        if (!state)
            return;
        state.healthy = false;
        state.cooldownUntil = Date.now() + 5_000;
        if (endpoint === this.activeEndpoint) {
            this.failover();
        }
    }
    failover() {
        const candidates = this.getEndpointsInPriorityOrder();
        if (candidates.length > 0) {
            this.activeEndpoint = candidates[0];
            this.logger.warn("RPC failover", { endpoint: this.activeEndpoint });
        }
        return this.activeEndpoint;
    }
    async getRecentPriorityFeeMicrolamports() {
        try {
            const fees = await this.getActiveConnection().getRecentPrioritizationFees();
            if (!fees.length)
                return;
            const sorted = fees.map((x) => x.prioritizationFee).sort((a, b) => a - b);
            return sorted[Math.floor(sorted.length * 0.75)];
        }
        catch {
            return undefined;
        }
    }
}
