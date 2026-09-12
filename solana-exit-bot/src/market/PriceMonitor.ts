import { EventEmitter } from "node:events";
import { PriceTick } from "../types.js";

export class PriceMonitor extends EventEmitter {
  private readonly ticks = new Map<string, PriceTick[]>();

  constructor(private readonly maxTicks = 256) {
    super();
  }

  ingest(tick: PriceTick): void {
    const existing = this.ticks.get(tick.mint) ?? [];
    existing.push(tick);
    if (existing.length > this.maxTicks) existing.shift();
    this.ticks.set(tick.mint, existing);
    this.emit("tick", tick);
  }

  getTicks(mint: string, windowMs?: number): PriceTick[] {
    const data = this.ticks.get(mint) ?? [];
    if (!windowMs) return data;
    const cutoff = Date.now() - windowMs;
    return data.filter((t) => t.timestamp >= cutoff);
  }

  isStale(mint: string, staleMs: number): boolean {
    const data = this.ticks.get(mint) ?? [];
    const latest = data[data.length - 1];
    if (!latest) return true;
    return Date.now() - latest.timestamp > staleMs;
  }
}
