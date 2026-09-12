import { EventEmitter } from "node:events";
export class WebSocketManager extends EventEmitter {
    subscriptions = new Set();
    connected = false;
    lastMessageAt = 0;
    connect() {
        this.connected = true;
        this.lastMessageAt = Date.now();
        this.emit("connected");
    }
    disconnect() {
        this.connected = false;
        this.emit("disconnected");
    }
    receiveMessage() {
        this.lastMessageAt = Date.now();
    }
    isStale(staleMs) {
        if (!this.connected)
            return true;
        return Date.now() - this.lastMessageAt > staleMs;
    }
    subscribe(key) {
        this.subscriptions.add(key);
    }
    unsubscribe(key) {
        this.subscriptions.delete(key);
    }
    getSubscriptionKeys() {
        return [...this.subscriptions.values()];
    }
    reconnectAndResubscribe() {
        this.disconnect();
        this.connect();
        for (const key of this.subscriptions) {
            this.emit("resubscribe", key);
        }
    }
}
