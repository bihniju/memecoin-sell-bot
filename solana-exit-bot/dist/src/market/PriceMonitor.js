import { EventEmitter } from "node:events";
export class PriceMonitor extends EventEmitter {
    maxTicks;
    ticks = new Map();
    constructor(maxTicks = 256) {
        super();
        this.maxTicks = maxTicks;
    }
    ingest(tick) {
        const existing = this.ticks.get(tick.mint) ?? [];
        existing.push(tick);
        if (existing.length > this.maxTicks)
            existing.shift();
        this.ticks.set(tick.mint, existing);
        this.emit("tick", tick);
    }
    getTicks(mint, windowMs) {
        const data = this.ticks.get(mint) ?? [];
        if (!windowMs)
            return data;
        const cutoff = Date.now() - windowMs;
        return data.filter((t) => t.timestamp >= cutoff);
    }
    isStale(mint, staleMs) {
        const data = this.ticks.get(mint) ?? [];
        const latest = data[data.length - 1];
        if (!latest)
            return true;
        return Date.now() - latest.timestamp > staleMs;
    }
}
