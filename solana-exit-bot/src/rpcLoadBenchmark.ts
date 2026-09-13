type Outcome = "ok" | "error";

interface Sample {
  latencyMs: number;
  outcome: Outcome;
  duplicate: boolean;
}

interface ScenarioResult {
  rate: number;
  durationMs: number;
  requested: number;
  completed: number;
  errors: number;
  duplicates: number;
  maxInFlight: number;
  maxQueue: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxLatencyMs: number;
  memoryDeltaMb: number;
}

const rates = [10, 25, 50, 100];
const durationMs = Number(process.env.RPC_LOAD_DURATION_MS ?? 5000);
const serviceLatencyMs = Number(process.env.RPC_LOAD_SERVICE_LATENCY_MS ?? 35);
const jitterMs = Number(process.env.RPC_LOAD_JITTER_MS ?? 10);
const errorRate = Number(process.env.RPC_LOAD_ERROR_RATE ?? 0.01);
const concurrency = Number(process.env.RPC_LOAD_CONCURRENCY ?? 32);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function runScenario(rate: number): Promise<ScenarioResult> {
  const beforeMemory = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  const deadline = startedAt + durationMs;
  const queue: number[] = [];
  const samples: Sample[] = [];
  const inFlight = new Set<Promise<void>>();
  const seenExecutionIds = new Set<number>();
  let requested = 0;
  let maxQueue = 0;
  let maxInFlight = 0;

  const service = async (executionId: number): Promise<void> => {
    const start = performance.now();
    const jitter = Math.floor(Math.random() * (jitterMs + 1));
    await sleep(Math.max(0, serviceLatencyMs + jitter));
    const duplicate = seenExecutionIds.has(executionId);
    seenExecutionIds.add(executionId);
    const outcome: Outcome = Math.random() < errorRate ? "error" : "ok";
    samples.push({ latencyMs: performance.now() - start, outcome, duplicate });
  };

  const drain = async (): Promise<void> => {
    while (queue.length > 0 && inFlight.size < concurrency) {
      const executionId = queue.shift()!;
      let task: Promise<void>;
      task = service(executionId).finally(() => inFlight.delete(task));
      inFlight.add(task);
      maxInFlight = Math.max(maxInFlight, inFlight.size);
    }
    maxQueue = Math.max(maxQueue, queue.length);
  };

  let nextTick = startedAt;
  let executionId = 0;
  while (nextTick < deadline) {
    const now = performance.now();
    if (now < nextTick) await sleep(nextTick - now);
    if (performance.now() >= deadline) break;

    queue.push(executionId++);
    requested += 1;
    await drain();
    nextTick += 1000 / rate;
  }

  while (queue.length > 0 || inFlight.size > 0) {
    await drain();
    if (inFlight.size > 0) await Promise.race(inFlight);
  }

  const completed = samples.length;
  const errors = samples.filter((sample) => sample.outcome === "error").length;
  const duplicates = samples.filter((sample) => sample.duplicate).length;
  const latencies = samples.map((sample) => sample.latencyMs);
  const memoryDeltaMb = (process.memoryUsage().heapUsed - beforeMemory) / 1024 / 1024;

  return {
    rate,
    durationMs,
    requested,
    completed,
    errors,
    duplicates,
    maxInFlight,
    maxQueue,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    maxLatencyMs: latencies.length ? Math.max(...latencies) : 0,
    memoryDeltaMb
  };
}

async function main(): Promise<void> {
  if (durationMs <= 0 || serviceLatencyMs < 0 || jitterMs < 0 || errorRate < 0 || errorRate > 1 || concurrency <= 0) {
    throw new Error("Invalid load-test configuration");
  }

  process.stdout.write("RPC LOAD BENCHMARK — SIMULATION ONLY (NO NETWORK, NO BROADCAST)\n");
  process.stdout.write(`duration=${durationMs}ms service=${serviceLatencyMs}ms±${jitterMs}ms concurrency=${concurrency} errorRate=${errorRate}\n\n`);

  const results: ScenarioResult[] = [];
  for (const rate of rates) {
    const result = await runScenario(rate);
    results.push(result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }

  const failed = results.some((result) =>
    result.completed !== result.requested ||
    result.duplicates !== 0 ||
    result.p95Ms > 250 ||
    result.maxQueue > Math.max(10, result.rate)
  );

  process.stdout.write(`\n${failed ? "RPC_LOAD_RESULT=FAIL" : "RPC_LOAD_RESULT=PASS"}\n`);
  if (failed) process.exitCode = 1;
}

void main();
