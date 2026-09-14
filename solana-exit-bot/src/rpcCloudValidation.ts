import { performance } from "node:perf_hooks";

type EndpointStats = {
  endpoint: string;
  requests: number;
  successes: number;
  failures: number;
  latencies: number[];
};

const endpoints = (process.env.RPC_VALIDATION_ENDPOINTS ??
  "https://api.mainnet-beta.solana.com,https://solana-rpc.publicnode.com")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);
const durationMs = Number(process.env.RPC_VALIDATION_DURATION_MS ?? 30_000);
const ratePerSecond = Number(process.env.RPC_VALIDATION_RATE ?? 10);
const requestTimeoutMs = Number(process.env.RPC_VALIDATION_TIMEOUT_MS ?? 3_000);

if (endpoints.length < 2) throw new Error("At least two RPC endpoints are required");
if (!Number.isFinite(durationMs) || durationMs < 5_000) throw new Error("RPC_VALIDATION_DURATION_MS must be >= 5000");
if (!Number.isFinite(ratePerSecond) || ratePerSecond < 1) throw new Error("RPC_VALIDATION_RATE must be >= 1");

function percentile(values: number[], rank: number): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * rank;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

async function rpcCall(endpoint: string): Promise<number> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "getSlot", params: [{ commitment: "processed" }] }),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { result?: unknown; error?: unknown };
    if (body.error || typeof body.result !== "number") throw new Error("Invalid JSON-RPC response");
    return performance.now() - started;
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const stats = new Map(endpoints.map((endpoint) => [endpoint, { endpoint, requests: 0, successes: 0, failures: 0, latencies: [] } as EndpointStats]));
  const intervalMs = 1000 / ratePerSecond;
  const startedAt = Date.now();
  let nextEndpoint = 0;
  let inFlight = 0;
  let peakInFlight = 0;
  let scheduled = 0;

  const jobs: Promise<void>[] = [];
  const schedule = async (endpoint: string): Promise<void> => {
    const state = stats.get(endpoint)!;
    state.requests += 1;
    inFlight += 1;
    peakInFlight = Math.max(peakInFlight, inFlight);
    try {
      const latency = await rpcCall(endpoint);
      state.successes += 1;
      state.latencies.push(latency);
    } catch {
      state.failures += 1;
    } finally {
      inFlight -= 1;
    }
  };

  while (Date.now() - startedAt < durationMs) {
    const endpoint = endpoints[nextEndpoint++ % endpoints.length];
    jobs.push(schedule(endpoint));
    scheduled += 1;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  await Promise.all(jobs);

  const summaries = [...stats.values()].map((state) => ({
    endpoint: state.endpoint,
    requests: state.requests,
    successes: state.successes,
    failures: state.failures,
    errorRate: state.requests ? state.failures / state.requests : 1,
    p50Ms: percentile(state.latencies, 0.5),
    p95Ms: percentile(state.latencies, 0.95),
    p99Ms: percentile(state.latencies, 0.99),
    maxMs: state.latencies.length ? Math.max(...state.latencies) : Number.NaN
  }));

  const totalRequests = summaries.reduce((sum, x) => sum + x.requests, 0);
  const totalFailures = summaries.reduce((sum, x) => sum + x.failures, 0);
  const healthyEndpoints = summaries.filter((x) => x.successes > 0).length;
  const overallErrorRate = totalRequests ? totalFailures / totalRequests : 1;

  console.log(JSON.stringify({
    result: healthyEndpoints >= 2 && overallErrorRate <= 0.10 ? "PASS" : "FAIL",
    safety: "READ_ONLY_NO_BROADCAST",
    durationMs,
    configuredRatePerSecond: ratePerSecond,
    scheduled,
    peakInFlight,
    totalRequests,
    totalFailures,
    overallErrorRate,
    healthyEndpoints,
    endpoints: summaries
  }, null, 2));

  if (healthyEndpoints < 2) throw new Error(`Fewer than two RPC endpoints responded successfully (${healthyEndpoints}/${endpoints.length})`);
  if (overallErrorRate > 0.10) throw new Error(`RPC error rate exceeded 10%: ${(overallErrorRate * 100).toFixed(2)}%`);
}

await main();
