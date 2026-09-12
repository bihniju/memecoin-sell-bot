import { EventEmitter } from "node:events";
export class LiquidityMonitor extends EventEmitter {
    snapshots = new Map();
    ingest(snapshot) {
        const existing = this.snapshots.get(snapshot.mint) ?? [];
        existing.push(snapshot);
        if (existing.length > 256)
            existing.shift();
        this.snapshots.set(snapshot.mint, existing);
        this.emit("liquidity", snapshot);
    }
    latest(mint) {
        const data = this.snapshots.get(mint) ?? [];
        return data[data.length - 1];
    }
    getSnapshots(mint, windowMs) {
        const data = this.snapshots.get(mint) ?? [];
        if (!windowMs)
            return data;
        const cutoff = Date.now() - windowMs;
        return data.filter((x) => x.timestamp >= cutoff);
    }
}
