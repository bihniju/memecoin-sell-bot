import { EventEmitter } from "node:events";
import WebSocket from "ws";

export interface MarketDataProvider {
  connect(): Promise<void>;
  subscribe(key: string): Promise<void>;
  unsubscribe(key: string): Promise<void>;
  disconnect(): Promise<void>;
}

interface SubscriptionMeta { id: number; key: string; }
interface ProviderOptions { heartbeatMs: number; staleMs: number; reconnectBaseMs: number; reconnectMaxMs: number; }

export class WebSocketManager extends EventEmitter implements MarketDataProvider {
  private ws?: WebSocket;
  private reconnectAttempts = 0;
  private requestId = 1;
  private connected = false;
  private readonly subscriptions = new Map<string, SubscriptionMeta>();
  private heartbeatTimer?: NodeJS.Timeout;
  private healthTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private lastMessageAt = 0;
  private manualClose = false;

  constructor(private readonly endpoint: string, private readonly options: ProviderOptions) { super(); }

  async connect(): Promise<void> {
    this.manualClose = false;
    await this.openSocket();
    this.startHealthTimers();
  }

  async disconnect(): Promise<void> {
    this.manualClose = true;
    this.clearTimers();
    await this.closeSocket();
    this.connected = false;
    this.emit("disconnected");
  }

  async subscribe(key: string): Promise<void> {
    const isMint = key.startsWith("mint:");
    const mint = key.slice(5);
    const id = isMint
      ? await this.sendRpc("logsSubscribe", [{ mentions: [mint] }, { commitment: "processed" }])
      : await this.sendRpc("slotSubscribe", []);
    this.subscriptions.set(key, { id, key });
  }

  async unsubscribe(key: string): Promise<void> {
    const sub = this.subscriptions.get(key);
    if (!sub) return;
    const method = key.startsWith("mint:") ? "logsUnsubscribe" : "slotUnsubscribe";
    await this.sendRpc(method, [sub.id]);
    this.subscriptions.delete(key);
  }

  isStale(): boolean { return !this.connected || Date.now() - this.lastMessageAt > this.options.staleMs; }

  private async openSocket(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.endpoint);
      this.ws = ws;

      ws.once("open", () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.lastMessageAt = Date.now();
        this.emit("connected");
        resolve();
      });
      ws.on("message", (msg) => this.handleMessage(msg.toString()));
      ws.on("pong", () => { this.lastMessageAt = Date.now(); });
      ws.on("close", () => {
        this.connected = false;
        this.emit("disconnected");
        if (!this.manualClose) this.scheduleReconnect();
      });
      ws.on("error", (err) => {
        this.emit("error", err);
        if (!this.connected) reject(err);
      });
    });
  }

  private async closeSocket(): Promise<void> {
    if (!this.ws) return;
    await new Promise<void>((resolve) => {
      const ws = this.ws;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        ws?.removeListener("close", done);
        resolve();
      };
      ws.once("close", done);
      ws.close();
      setTimeout(done, 1_000);
    });
    this.ws = undefined;
  }

  private handleMessage(raw: string): void {
    this.lastMessageAt = Date.now();
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch { return; }

    if (typeof parsed.id === "number") {
      this.emit(`rpc:${parsed.id}`, parsed);
      return;
    }

    const params = parsed.params as { result?: unknown; subscription?: number } | undefined;
    if (!params) return;

    const subscriptionId = params.subscription;
    const subscription = typeof subscriptionId === "number"
      ? [...this.subscriptions.values()].find((item) => item.id === subscriptionId)
      : undefined;
    const mint = subscription?.key.startsWith("mint:") ? subscription.key.slice(5) : undefined;

    const result = params.result as Record<string, unknown> | undefined;
    if (result && typeof result === "object" && ("value" in result || "context" in result)) {
      this.emit("marketEvent", {
        type: "logs",
        mint,
        subscription: subscriptionId,
        slot: (result.context as { slot?: number } | undefined)?.slot,
        receivedAt: Date.now(),
        result
      });
      return;
    }

    const slot = result?.slot;
    if (typeof slot === "number") this.emit("marketEvent", { type: "slot", mint, subscription: subscriptionId, slot, receivedAt: Date.now() });
  }

  private startHealthTimers(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.ping();
    }, this.options.heartbeatMs);
    this.healthTimer = setInterval(() => {
      if (this.isStale()) {
        this.emit("stale");
        if (!this.manualClose) this.scheduleReconnect();
      }
    }, Math.max(250, Math.floor(this.options.heartbeatMs / 2)));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.manualClose) return;
    const delay = Math.min(this.options.reconnectMaxMs, this.options.reconnectBaseMs * 2 ** this.reconnectAttempts);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      try {
        await this.openSocket();
        const keys = [...this.subscriptions.keys()];
        this.subscriptions.clear();
        for (const key of keys) {
          await this.subscribe(key);
          this.emit("resubscribe", key);
        }
      } catch { this.scheduleReconnect(); }
    }, delay);
  }

  private async sendRpc(method: string, params: unknown[]): Promise<number> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("WebSocket is not connected");
    const id = this.requestId++;
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => { this.off(`rpc:${id}`, onMessage); reject(new Error(`WS RPC timeout for ${method}`)); }, 10_000);
      const onMessage = (response: Record<string, unknown>): void => {
        clearTimeout(timeout);
        this.off(`rpc:${id}`, onMessage);
        if (response.error) { reject(new Error(`WS RPC error: ${JSON.stringify(response.error)}`)); return; }
        if (typeof response.result !== "number") { reject(new Error("WS RPC response missing numeric subscription id")); return; }
        resolve(response.result);
      };
      this.on(`rpc:${id}`, onMessage);
    });
  }

  private clearTimers(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.heartbeatTimer = undefined;
    this.healthTimer = undefined;
    this.reconnectTimer = undefined;
  }
}

export class SolanaWebSocketAdapter extends WebSocketManager {
  constructor(endpoint: string, heartbeatMs: number, staleMs: number) {
    super(endpoint, { heartbeatMs, staleMs, reconnectBaseMs: 500, reconnectMaxMs: 10_000 });
  }
}

export class HeliusWebSocketAdapter extends WebSocketManager {
  constructor(endpoint: string, heartbeatMs: number, staleMs: number) {
    super(endpoint, { heartbeatMs, staleMs, reconnectBaseMs: 250, reconnectMaxMs: 5_000 });
  }
}
