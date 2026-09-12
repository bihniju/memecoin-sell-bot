import { EventEmitter } from "node:events";

export class WebSocketManager extends EventEmitter {
  private readonly subscriptions = new Set<string>();
  private connected = false;
  private lastMessageAt = 0;

  connect(): void {
    this.connected = true;
    this.lastMessageAt = Date.now();
    this.emit("connected");
  }

  disconnect(): void {
    this.connected = false;
    this.emit("disconnected");
  }

  receiveMessage(): void {
    this.lastMessageAt = Date.now();
  }

  isStale(staleMs: number): boolean {
    if (!this.connected) return true;
    return Date.now() - this.lastMessageAt > staleMs;
  }

  subscribe(key: string): void {
    this.subscriptions.add(key);
  }

  unsubscribe(key: string): void {
    this.subscriptions.delete(key);
  }

  getSubscriptionKeys(): string[] {
    return [...this.subscriptions.values()];
  }

  reconnectAndResubscribe(): void {
    this.disconnect();
    this.connect();
    for (const key of this.subscriptions) {
      this.emit("resubscribe", key);
    }
  }
}
