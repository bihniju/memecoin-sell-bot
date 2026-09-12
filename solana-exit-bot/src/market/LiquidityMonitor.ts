import { EventEmitter } from "node:events";
import { LiquiditySnapshot } from "../types.js";

export class LiquidityMonitor extends EventEmitter {
  private readonly snapshots = new Map<string, LiquiditySnapshot[]>();

  ingest(snapshot: LiquiditySnapshot): void {
    const existing = this.snapshots.get(snapshot.mint) ?? [];
    existing.push(snapshot);
    if (existing.length > 256) existing.shift();
    this.snapshots.set(snapshot.mint, existing);
    this.emit("liquidity", snapshot);
  }

  latest(mint: string): LiquiditySnapshot | undefined {
    const data = this.snapshots.get(mint) ?? [];
    return data[data.length - 1];
  }

  getSnapshots(mint: string, windowMs?: number): LiquiditySnapshot[] {
    const data = this.snapshots.get(mint) ?? [];
    if (!windowMs) return data;
    const cutoff = Date.now() - windowMs;
    return data.filter((x) => x.timestamp >= cutoff);
  }
}
