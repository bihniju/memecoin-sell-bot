import { Logger } from "../logging/Logger.js";

interface EndpointHealth {
  endpoint: string;
  healthy: boolean;
  latencyMs: number;
  cooldownUntil: number;
}

export class RpcManager {
  private readonly health = new Map<string, EndpointHealth>();
  private activeEndpoint: string;

  constructor(private readonly endpoints: string[], private readonly logger: Logger) {
    if (endpoints.length === 0) throw new Error("At least one RPC endpoint is required");
    this.activeEndpoint = endpoints[0];
    for (const endpoint of endpoints) {
      this.health.set(endpoint, { endpoint, healthy: true, latencyMs: Number.MAX_SAFE_INTEGER, cooldownUntil: 0 });
    }
  }

  getActiveEndpoint(): string {
    return this.activeEndpoint;
  }

  async recordHealthCheck(endpoint: string, latencyMs: number, healthy: boolean): Promise<void> {
    const state = this.health.get(endpoint);
    if (!state) return;
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

  failover(): string {
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
