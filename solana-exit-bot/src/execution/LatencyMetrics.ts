export interface LatencySample {
  signalLatencyMs: number;
  quoteLatencyMs: number;
  buildLatencyMs: number;
  submissionLatencyMs?: number;
  confirmationLatencyMs?: number;
  totalExitLatencyMs?: number;
}

export interface LatencyPercentiles {
  count: number;
  p50?: number;
  p75?: number;
  p90?: number;
  p95?: number;
  p99?: number;
  max?: number;
}

function percentile(values: number[], percentileRank: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * percentileRank;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function summarizeLatencies(values: number[]): LatencyPercentiles {
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    p90: percentile(values, 0.9),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    max: values.length ? Math.max(...values) : undefined
  };
}

export class ExitLatencyMetrics {
  private readonly samples: LatencySample[] = [];

  record(sample: LatencySample): void {
    this.samples.push({ ...sample });
  }

  get count(): number { return this.samples.length; }

  summary(): Record<keyof LatencySample, LatencyPercentiles> {
    const keys: Array<keyof LatencySample> = [
      "signalLatencyMs",
      "quoteLatencyMs",
      "buildLatencyMs",
      "submissionLatencyMs",
      "confirmationLatencyMs",
      "totalExitLatencyMs"
    ];
    return Object.fromEntries(
      keys.map((key) => [
        key,
        summarizeLatencies(
          this.samples
            .map((sample) => sample[key])
            .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
        )
      ])
    ) as Record<keyof LatencySample, LatencyPercentiles>;
  }
}
