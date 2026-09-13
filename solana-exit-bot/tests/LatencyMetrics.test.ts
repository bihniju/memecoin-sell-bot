import { describe, expect, test } from "vitest";
import { ExitLatencyMetrics, summarizeLatencies } from "../src/execution/LatencyMetrics.js";

describe("exit latency metrics", () => {
  test("calculates deterministic percentile values", () => {
    const summary = summarizeLatencies([1, 2, 3, 4, 5]);
    expect(summary.count).toBe(5);
    expect(summary.p50).toBe(3);
    expect(summary.p75).toBe(4);
    expect(summary.p90).toBe(4.6);
    expect(summary.p95).toBe(4.8);
    expect(summary.p99).toBe(4.96);
    expect(summary.max).toBe(5);
  });

  test("aggregates only finite stage samples", () => {
    const metrics = new ExitLatencyMetrics();
    metrics.record({ signalLatencyMs: 2, quoteLatencyMs: 10, buildLatencyMs: 3, totalExitLatencyMs: 50 });
    metrics.record({ signalLatencyMs: 4, quoteLatencyMs: 20, buildLatencyMs: 5, submissionLatencyMs: 7, confirmationLatencyMs: 30, totalExitLatencyMs: 70 });
    metrics.record({ signalLatencyMs: Number.NaN, quoteLatencyMs: 30, buildLatencyMs: 7, totalExitLatencyMs: Number.POSITIVE_INFINITY });

    const summary = metrics.summary();
    expect(metrics.count).toBe(3);
    expect(summary.signalLatencyMs.count).toBe(2);
    expect(summary.signalLatencyMs.p50).toBe(3);
    expect(summary.quoteLatencyMs.p95).toBe(29);
    expect(summary.submissionLatencyMs.count).toBe(1);
    expect(summary.confirmationLatencyMs.p50).toBe(30);
    expect(summary.totalExitLatencyMs.count).toBe(2);
    expect(summary.totalExitLatencyMs.p99).toBe(69.8);
  });

  test("returns an empty summary for no samples", () => {
    const summary = summarizeLatencies([]);
    expect(summary.count).toBe(0);
    expect(summary.p50).toBeUndefined();
    expect(summary.max).toBeUndefined();
  });
});
