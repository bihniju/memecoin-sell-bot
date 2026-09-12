import { EventEmitter } from "node:events";
import WebSocket from "ws";

export interface MarketDataProvider {
  connect(): Promise<void>;
  subscribe(key: string): Promise<void>;
  unsubscribe(key: string): Promise<void>;
  disconnect(): Promise<void>;
}

interface SubscriptionMeta {
  id: number;
  key: string;
}

interface ProviderOptions {
  heartbeatMs: number;
  staleMs: number;
  reconnectBaseMs: number;
  reconnectMaxMs: number;
}

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

  constructor(
    private readonly endpoint: string,
    private readonly options: ProviderOptions
  ) {
    super();
  }

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
    const id = await this.sendRpc("slotSubscribe", []);
    this.subscriptions.set(key, { id, key });
  }

  async unsubscribe(key: string): Promise<void> {
    const sub = this.subscriptions.get(key);
    if (!sub) return;
    await this.sendRpc("slotUnsubscribe", [sub.id]);
    this.subscriptions.delete(key);
  }

  isStale(): boolean {
    if (!this.connected) return true;
    return Date.now() - this.lastMessageAt > this.options.staleMs;
  }

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

      ws.on("pong", () => {
        this.lastMessageAt = Date.now();
      });

      ws.on("close", () => {
        this.connected = false;
        this.emit("disconnected");
        if (!this.manualClose) {
          this.scheduleReconnect();
        }
      });

      ws.on("error", (err) => {
        this.emit("error", err);
        if (!this.connected) {
          reject(err);
        }
      });
    });
  }

  private async closeSocket(): Promise<void> {
    if (!this.ws) return;
    await new Promise<void>((resolve) => {
      this.ws?.once("close", () => resolve());
      this.ws?.close();
    });
    this.ws = undefined;
  }

  private handleMessage(raw: string): void {
    this.lastMessageAt = Date.now();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    if (typeof parsed.id === "number") {
      this.emit(`rpc:${parsed.id}`, parsed);
      return;
    }

    const params = parsed.params as { result?: { slot?: number } } | undefined;
    const slot = params?.result?.slot;
    if (typeof slot === "number") {
      this.emit("marketEvent", {
        type: "slot",
        slot,
        receivedAt: Date.now()
      });
    }
  }

  private startHealthTimers(): void {
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.ping();
    }, this.options.heartbeatMs);

    this.healthTimer = setInterval(() => {
      if (this.isStale()) {
        this.emit("stale");
        if (!this.manualClose) {
          this.scheduleReconnect();
        }
      }
    }, Math.max(250, Math.floor(this.options.heartbeatMs / 2)));
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.manualClose) return;

    const delay = Math.min(
      this.options.reconnectMaxMs,
      this.options.reconnectBaseMs * 2 ** this.reconnectAttempts
    );
    this.reconnectAttempts += 1;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      try {
        await this.openSocket();
        for (const key of this.subscriptions.keys()) {
          await this.subscribe(key);
          this.emit("resubscribe", key);
        }
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  private async sendRpc(method: string, params: unknown[]): Promise<number> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }

    const id = this.requestId;
    this.requestId += 1;

    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params
    };

    this.ws.send(JSON.stringify(payload));

    return await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.off(`rpc:${id}`, onMessage);
        reject(new Error(`WS RPC timeout for ${method}`));
      }, 10_000);

      const onMessage = (response: Record<string, unknown>): void => {
        clearTimeout(timeout);
        this.off(`rpc:${id}`, onMessage);
        if (response.error) {
          reject(new Error(`WS RPC error: ${JSON.stringify(response.error)}`));
          return;
        }
        const result = response.result;
        if (typeof result !== "number") {
          reject(new Error("WS RPC response missing numeric subscription id"));
          return;
        }
        resolve(result);
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
    super(endpoint, {
      heartbeatMs,
      staleMs,
      reconnectBaseMs: 500,
      reconnectMaxMs: 10_000
    });
  }
}

export class HeliusWebSocketAdapter extends WebSocketManager {
  constructor(endpoint: string, heartbeatMs: number, staleMs: number) {
    super(endpoint, {
      heartbeatMs,
      staleMs,
      reconnectBaseMs: 250,
      reconnectMaxMs: 5_000
    });
  }
}
