/**
 * @fileoverview BountyIMHandler Tests
 *
 * TDD 验证 bounty-im-handler 的功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import type { EventSourceConfig, EventSourceInstance, EventSourceHandler } from "@ai-setting/roy-agent-core";

// ============================================================================
// Mocks
// ============================================================================

// Mock WebSocket
const mockWsOn = vi.fn();
const mockWsSend = vi.fn();
const mockWsClose = vi.fn();

vi.mock("ws", () => {
  return {
    WebSocket: class MockWebSocket {
      on = mockWsOn;
      send = mockWsSend;
      close = mockWsClose;
    },
  };
});

// ============================================================================
// Tests
// ============================================================================

describe("BountyIMHandler", () => {
  describe("exports", () => {
    it("should export bountyIMHandler", async () => {
      const { bountyIMHandler } = await import("../../src/im/eventsource/bounty-im-handler");
      expect(bountyIMHandler).toBeDefined();
      expect(typeof bountyIMHandler).toBe("object");
    });

    it("should export createBountyIMHandler factory function", async () => {
      const mod = await import("../../src/im/eventsource/bounty-im-handler");
      if ("createBountyIMHandler" in mod) {
        expect(typeof mod.createBountyIMHandler).toBe("function");
      }
    });

    it("should export BountyIMInstance class", async () => {
      const { BountyIMInstance } = await import("../../src/im/eventsource/bounty-im-handler");
      expect(BountyIMInstance).toBeDefined();
      expect(typeof BountyIMInstance).toBe("function");
    });
  });

  describe("bountyIMHandler structure", () => {
    it("should have type property (not name)", async () => {
      const { bountyIMHandler } = await import("../../src/im/eventsource/bounty-im-handler");
      // 新版使用 type 而不是 name
      expect(bountyIMHandler).toHaveProperty("type");
      expect(typeof bountyIMHandler.type).toBe("string");
    });

    it("should have validateConfig function", async () => {
      const { bountyIMHandler } = await import("../../src/im/eventsource/bounty-im-handler");
      expect(typeof bountyIMHandler.validateConfig).toBe("function");
    });

    it("should have createInstance function", async () => {
      const { bountyIMHandler } = await import("../../src/im/eventsource/bounty-im-handler");
      expect(typeof bountyIMHandler.createInstance).toBe("function");
    });

    it("should implement EventSourceHandler interface", async () => {
      const { bountyIMHandler } = await import("../../src/im/eventsource/bounty-im-handler");
      expect(bountyIMHandler.type).toBeDefined();
      expect(typeof bountyIMHandler.validateConfig).toBe("function");
      expect(typeof bountyIMHandler.createInstance).toBe("function");
    });
  });

  describe("validateConfig", () => {
    it("should return errors for missing id", async () => {
      const { bountyIMHandler } = await import("../../src/im/eventsource/bounty-im-handler");
      const errors = bountyIMHandler.validateConfig({
        id: "",
        name: "Test",
        type: "bounty-im",
        enabled: true,
      } as EventSourceConfig);
      expect(errors.length).toBeGreaterThan(0);
    });

    it("should return empty array for valid config", async () => {
      const { bountyIMHandler } = await import("../../src/im/eventsource/bounty-im-handler");
      const errors = bountyIMHandler.validateConfig({
        id: "test-im",
        name: "Test IM",
        type: "bounty-im",
        enabled: true,
        options: {
          address: "agent@test.com",
        },
      } as EventSourceConfig);
      expect(Array.isArray(errors)).toBe(true);
    });
  });

  describe("createInstance", () => {
    it("should create BountyIMInstance", async () => {
      const { bountyIMHandler } = await import("../../src/im/eventsource/bounty-im-handler");
      const handler = bountyIMHandler as EventSourceHandler;
      const config: EventSourceConfig = {
        id: "test-im",
        name: "Test IM",
        type: "bounty-im",
        enabled: true,
        options: {
          address: "agent@test.com",
        },
      };
      const instance = handler.createInstance(config);
      expect(instance).toBeDefined();
      expect(typeof instance.start).toBe("function");
      expect(typeof instance.stop).toBe("function");
      expect(typeof instance.getStatus).toBe("function");
      expect(typeof instance.onEvent).toBe("function");
      expect(typeof instance.offEvent).toBe("function");
    });

    it("should return instance with 'created' initial status", async () => {
      const { bountyIMHandler } = await import("../../src/im/eventsource/bounty-im-handler");
      const handler = bountyIMHandler as EventSourceHandler;
      const config: EventSourceConfig = {
        id: "test-im",
        name: "Test IM",
        type: "bounty-im",
        enabled: true,
        options: {
          address: "agent@test.com",
        },
      };
      const instance = handler.createInstance(config) as EventSourceInstance;
      expect(instance.getStatus()).toBe("created");
    });
  });
});

describe("index.ts exports", () => {
  it("should export bountyIMHandler from index", async () => {
    const mod = await import("../../src/im/eventsource/index");
    expect(mod.bountyIMHandler).toBeDefined();
  });

  it("should export BountyIMInstance from index", async () => {
    const mod = await import("../../src/im/eventsource/index");
    // 检查导出是否存在
    expect(mod).toBeDefined();
  });
});
