import { afterEach, describe, expect, test } from "vitest";
import { WebSocketServer } from "ws";
import { SolanaWebSocketAdapter } from "../src/rpc/WebSocketManager.js";

const servers: WebSocketServer[] = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  servers.length = 0;
});

describe("WebSocketManager", () => {
  test("reconnects and resubscribes", async () => {
    const port = 19000 + Math.floor(Math.random() * 1000);
    const server = new WebSocketServer({ port });
    servers.push(server);

    let subCalls = 0;
    let conn: any;

    server.on("connection", (socket: any) => {
      conn = socket;
      socket.on("message", (raw: any) => {
        const msg = JSON.parse(raw.toString()) as { id: number; method: string };
        if (msg.method === "slotSubscribe") {
          subCalls += 1;
          socket.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: subCalls }));
        }
        if (msg.method === "slotUnsubscribe") {
          socket.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: true }));
        }
      });
    });

    const ws = new SolanaWebSocketAdapter(`ws://127.0.0.1:${port}`, 100, 200);
    await ws.connect();
    await ws.subscribe("mint:m");

    conn?.terminate();

    await new Promise((r) => setTimeout(r, 800));
    expect(subCalls).toBeGreaterThanOrEqual(2);

    await ws.disconnect();
  });
});
