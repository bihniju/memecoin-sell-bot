import { describe, expect, test } from "vitest";
import { WebSocketServer } from "ws";
import { SolanaWebSocketAdapter } from "../../src/rpc/WebSocketManager.js";

describe("websocket chaos", () => {
  test("fails over from a dead endpoint to a healthy endpoint", async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("failed to allocate test websocket port");

    const provider = new SolanaWebSocketAdapter(
      [`ws://127.0.0.1:1`, `ws://127.0.0.1:${address.port}`],
      10_000,
      5_000
    );

    try {
      await provider.connect();
      expect(provider.isStale()).toBe(false);
    } finally {
      await provider.disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 5_000);

  test("reports a disconnected provider as stale", async () => {
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("failed to allocate test websocket port");

    const provider = new SolanaWebSocketAdapter(`ws://127.0.0.1:${address.port}`, 10_000, 50);
    try {
      await provider.connect();
      expect(provider.isStale()).toBe(false);
      await provider.disconnect();
      expect(provider.isStale()).toBe(true);
    } finally {
      await provider.disconnect();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 5_000);
});
