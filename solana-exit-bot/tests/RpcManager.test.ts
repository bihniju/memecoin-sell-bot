import { describe, expect, test } from "vitest";
import { Logger } from "../src/logging/Logger.js";
import { RpcManager } from "../src/rpc/RpcManager.js";

describe("RpcManager", () => {
  test("fails over to healthy endpoint", async () => {
    const manager = new RpcManager(["http://a", "http://b"], new Logger("error"));
    await manager.recordHealthCheck("http://a", 50, false);
    await manager.recordHealthCheck("http://b", 10, true);

    expect(manager.getActiveEndpoint()).toBe("http://b");
  });

  test("marks timeout-like endpoint failure and cools it down", async () => {
    const manager = new RpcManager(["http://timeout", "http://healthy"], new Logger("error"));
    await manager.recordHealthCheck("http://timeout", 900, false);
    await manager.recordHealthCheck("http://healthy", 40, true);

    expect(manager.getEndpointsInPriorityOrder()).not.toContain("http://timeout");
    expect(manager.getActiveEndpoint()).toBe("http://healthy");
  });

  test("marks rate-limited and server-error endpoints unavailable until cooldown", async () => {
    const manager = new RpcManager(["http://429", "http://503", "http://healthy"], new Logger("error"));

    await manager.recordHealthCheck("http://429", 20, false);
    await manager.recordHealthCheck("http://503", 20, false);
    await manager.recordHealthCheck("http://healthy", 30, true);

    const ordered = manager.getEndpointsInPriorityOrder();
    expect(ordered).toEqual(["http://healthy"]);
    expect(manager.getActiveEndpoint()).toBe("http://healthy");
  });

  test("fails over when the active endpoint becomes unavailable", async () => {
    const manager = new RpcManager(["http://a", "http://b"], new Logger("error"));
    await manager.recordHealthCheck("http://a", 25, true);
    await manager.recordHealthCheck("http://b", 50, true);
    expect(manager.getActiveEndpoint()).toBe("http://a");

    manager.reportEndpointFailure("http://a");

    expect(manager.getActiveEndpoint()).toBe("http://b");
    expect(manager.getEndpointsInPriorityOrder()).not.toContain("http://a");
  });

  test("recovers a failed endpoint and clears its cooldown", async () => {
    const manager = new RpcManager(["http://a", "http://b"], new Logger("error"));
    await manager.recordHealthCheck("http://a", 20, false);
    expect(manager.getEndpointsInPriorityOrder()).toEqual(["http://b"]);

    await manager.recordHealthCheck("http://a", 15, true);

    expect(manager.getEndpointsInPriorityOrder()[0]).toBe("http://a");
    expect(manager.getBestLatencyMs()).toBe(15);
  });

  test("returns the active endpoint when all endpoints are unavailable", async () => {
    const manager = new RpcManager(["http://a", "http://b"], new Logger("error"));
    await manager.recordHealthCheck("http://a", 20, false);
    await manager.recordHealthCheck("http://b", 30, false);

    expect(manager.getEndpointsInPriorityOrder()).toEqual([]);
    expect(manager.failover()).toBe("http://b");
  });
});
