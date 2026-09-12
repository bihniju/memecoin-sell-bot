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
});
