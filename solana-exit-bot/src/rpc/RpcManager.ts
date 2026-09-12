import { Connection } from "@solana/web3.js";
import { Logger } from "../logging/Logger.js";
import { PriorityFeeSource } from "../execution/PriorityFeeManager.js";

interface EndpointHealth {
  endpoint: string;
  healthy: boolean;
  latencyMs: number;
  cooldownUntil: number;
  failures: number;
}

export class RpcManager implements PriorityFeeSource {
  private readonly health = new Map<string, EndpointHealth>();
  private readonly connections = new Map<string, Connection>();
  private activeEndpoint: string;

  constructor(private readonly endpoints: string[], private readonly logger: Logger) {
    if (endpoints.length === 0) throw new Error("At least one RPC endpoint is required");
    this.activeEndpoint = endpoints[0];
    for (const endpoint of endpoints) {
      this.health.set(endpoint, { endpoint, healthy: true, latencyMs: Number.MAX_SAFE_INTEGER, cooldownUntil: 0, failures: 0 });
      this.connections.set(endpoint, new Connection(endpoint, "processed"));
    }
  }

  getActiveEndpoint(): string { return this.activeEndpoint; }
  getActiveConnection(): Connection { return this.getConnection(this.activeEndpoint); }

  getEndpointsInPriorityOrder(): string[] {
    const now = Date.now();
    return [...this.health.values()]
      .filter((x) => x.cooldownUntil <= now)
      .sort((a, b) => {
        if (a.healthy !== b.healthy) return a.healthy ? -1 : 1;
        if (a.latencyMs !== b.latencyMs) return a.latencyMs - b.latencyMs;
        return a.failures - b.failures;
      })
      .map((x) => x.endpoint);
  }

  getConnection(endpoint: string): Connection {
    const connection = this.connections.get(endpoint);
    if (!connection) throw new Error(`Unknown RPC endpoint: ${endpoint}`);
    return connection;
  }

  async recordHealthCheck(endpoint: string, latencyMs: number, healthy: boolean): Promise<void> {
    const state = this.health.get(endpoint);
    if (!state) return;
    if (healthy) {
      state.healthy = true;
      state.latencyMs = Math.max(1, latencyMs);
      state.failures = Math.max(0, state.failures - 1);
      state.cooldownUntil = 0;
      if (state.latencyMs <= this.latencyOf(this.activeEndpoint)) this.activeEndpoint = endpoint;
    } else {
      state.healthy = false;
      state.failures += 1;
      state.cooldownUntil = Date.now() + Math.min(15_000, 1_000 * 2 ** Math.min(state.failures, 4));
      if (endpoint === this.activeEndpoint) this.failover();
    }
  }

  reportEndpointFailure(endpoint: string): void {
    void this.recordHealthCheck(endpoint, 0, false);
  }

  failover(): string {
    const candidates = this.getEndpointsInPriorityOrder();
    if (candidates.length > 0) {
      this.activeEndpoint = candidates[0];
      this.logger.warn("RPC failover", { endpoint: this.activeEndpoint });
    }
    return this.activeEndpoint;
  }

  isCongested(endpoint = this.activeEndpoint, thresholdMs = 800): boolean {
    const state = this.health.get(endpoint);
    return Boolean(state && state.latencyMs < Number.MAX_SAFE_INTEGER && state.latencyMs >= thresholdMs);
  }

  getBestLatencyMs(): number {
    const candidates = this.getEndpointsInPriorityOrder();
    if (!candidates.length) return Number.MAX_SAFE_INTEGER;
    return this.latencyOf(candidates[0]);
  }

  private latencyOf(endpoint: string): number {
    return this.health.get(endpoint)?.latencyMs ?? Number.MAX_SAFE_INTEGER;
  }

  async getRecentPriorityFeeMicrolamports(): Promise<number | undefined> {
    try {
      const fees = await this.getActiveConnection().getRecentPrioritizationFees();
      if (!fees.length) return;
      const sorted = fees.map((x) => x.prioritizationFee).sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * 0.9)];
    } catch {
      return undefined;
    }
  }
}
