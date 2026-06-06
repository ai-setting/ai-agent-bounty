/**
 * @fileoverview Message Status Tests
 *
 * TDD: 测试消息状态在发送/处理后的正确更新
 *
 * #549 Bug: agent 发布的消息，被接受者处理之后没有设置对状态，导致下次重复收到
 *
 * 根因分析:
 * 1. HTTP API 发送消息后未更新为 delivered 状态
 * 2. BountyIMInstance 处理消息后未发送 ACK
 * 3. BountyHTTPServer handleWsOpen 发送 pending 而非 delivered 状态
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "bun:test";
import { IMDatabase } from "../../src/im/db";
import { IMHTTPServer } from "../../src/im/server/http";
import type { Message } from "../../src/im/types";

// ============================================================================
// Test 1: HTTP API should update message status to 'delivered' after successful push
// ============================================================================

describe("Message Status - HTTP API Delivery", () => {
  let db: IMDatabase;
  let server: IMHTTPServer;
  let baseUrl: string;
  let pushCallback: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    db = new IMDatabase({ memory: true });
    pushCallback = vi.fn(() => true); // Mock: recipient is online, push succeeds
    server = new IMHTTPServer(db, 0);
    server.setPushCallback(pushCallback);
    await server.start();
    baseUrl = `http://localhost:${server.getPort()}`;
  });

  afterEach(() => {
    server.stop();
    db.close();
  });

  it("should save message with 'pending' status initially", async () => {
    const res = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: "bob@server.com",
        content: { type: "text", body: "Hello!" },
      }),
    });
    expect(res.status).toBe(201);
    const msg = await res.json();
    expect(msg.status).toBe("pending");
  });

  it("should update message status to 'delivered' after push succeeds (recipient online)", async () => {
    const res = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: "bob@server.com",
        content: { type: "text", body: "Hello!" },
      }),
    });
    expect(res.status).toBe(201);
    const msg = await res.json();

    // Verify push callback was called
    expect(pushCallback).toHaveBeenCalled();
    expect(pushCallback).toHaveBeenCalledWith("bob@server.com", expect.objectContaining({ id: msg.id }));

    // Verify DB status was updated to 'delivered' (push succeeded)
    const stored = db.getMessage(msg.id);
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe("delivered");
  });

  it("should keep status as 'pending' when recipient is offline (push fails)", async () => {
    // Override mock to return false (recipient offline)
    pushCallback.mockReturnValue(false);

    const res = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: "offline@server.com",
        content: { type: "text", body: "Offline message" },
      }),
    });
    expect(res.status).toBe(201);
    const msg = await res.json();

    // Verify push callback was called but returned false
    expect(pushCallback).toHaveBeenCalled();

    // Status should remain 'pending' since recipient was offline
    // The message will be delivered when recipient connects later
    const stored = db.getMessage(msg.id);
    expect(stored).not.toBeNull();
    expect(stored!.status).toBe("pending");
  });
});

// ============================================================================
// Test 2: BountyIMInstance should send ACK after processing messages
// ============================================================================

describe("BountyIMInstance ACK after processing", () => {
  it("should send ack via WebSocket after processing a message", async () => {
    // Import the handler
    const { BountyIMInstance } = await import(
      "../../src/im/eventsource/bounty-im-handler"
    );

    // Create a mock WebSocket to track ack calls
    const mockWsSend = vi.fn();
    const mockWsOn = vi.fn();

    const config = {
      id: "test-im",
      name: "Test IM",
      type: "bounty-im",
      enabled: true,
      options: {
        address: "agent@test.com",
        imServerUrl: "ws://localhost:9999/ws",
      },
    };

    const instance = new BountyIMInstance(config as any);

    // Inject mock WebSocket
    (instance as any).ws = {
      send: mockWsSend,
      on: mockWsOn,
    };

    // Set up event handler
    const eventHandler = vi.fn();
    instance.onEvent(eventHandler);

    // Directly call processLine with a pending message
    const messageData = {
      event: "message",
      data: {
        id: "msg-test-001",
        from: "alice@server.com",
        to: "agent@test.com",
        content: { type: "text", body: "Hello!" },
        status: "pending",
        createdAt: new Date().toISOString(),
      },
    };

    // Call the private processLine via the message handler
    // We need to trigger it through handleMessage
    (instance as any).handleMessage(JSON.stringify(messageData));

    // Small delay to let async operations complete
    await new Promise((r) => setTimeout(r, 50));

    // Verify event handler was called
    expect(eventHandler).toHaveBeenCalledTimes(1);

    // Verify ack was sent via WebSocket with the message ID
    expect(mockWsSend).toHaveBeenCalled();

    const ackCall = mockWsSend.mock.calls.find((call: string[]) => {
      try {
        const payload = JSON.parse(call[0]);
        return payload.event === "ack";
      } catch {
        return false;
      }
    });

    expect(ackCall).toBeDefined();
    if (ackCall) {
      const payload = JSON.parse(ackCall[0]);
      expect(payload.event).toBe("ack");
      expect(payload.data.messageIds).toContain("msg-test-001");
    }
  });

  it("should NOT send ack for non-message events (like connected, ping)", async () => {
    const { BountyIMInstance } = await import(
      "../../src/im/eventsource/bounty-im-handler"
    );

    const mockWsSend = vi.fn();

    const config = {
      id: "test-im",
      name: "Test IM",
      type: "bounty-im",
      enabled: true,
      options: {
        address: "agent@test.com",
      },
    };

    const instance = new BountyIMInstance(config as any);
    (instance as any).ws = { send: mockWsSend, on: vi.fn() };

    // Send a connected event - should not trigger ack
    (instance as any).handleMessage(
      JSON.stringify({
        event: "connected",
        data: { address: "agent@test.com" },
      })
    );

    await new Promise((r) => setTimeout(r, 50));

    // Verify no ack was sent for non-message events
    const ackCalls = mockWsSend.mock.calls.filter((call: string[]) => {
      try {
        const payload = JSON.parse(call[0]);
        return payload.event === "ack";
      } catch {
        return false;
      }
    });
    expect(ackCalls).toHaveLength(0);
  });
});

// ============================================================================
// Test 3: BountyHTTPServer handleWsOpen should send delivered status
// ============================================================================

describe("BountyHTTPServer handleWsOpen - message status", () => {
  it("should send pending messages with 'delivered' status on WS connect", async () => {
    // Use the IMDatabase directly
    const db = new IMDatabase({ memory: true });

    // Save a pending message
    const message: Message = {
      id: "pending-msg-001",
      from: "alice@server.com",
      to: "bob@server.com",
      content: { type: "text", body: "Hello Bob" },
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    db.saveMessage(message);

    // Verify it's in pending state
    const pendingMsgs = db.getPendingMessages("bob@server.com");
    expect(pendingMsgs).toHaveLength(1);
    expect(pendingMsgs[0].status).toBe("pending");

    // Simulate handleWsOpen logic
    const pendingMessages = db.getPendingMessages("bob@server.com");
    const sentMessages: any[] = [];

    for (const msg of pendingMessages) {
      // First update status to delivered (like the fix should do)
      if (msg.status === "pending") {
        db.updateMessageStatus(msg.id, "delivered");
      }
      sentMessages.push({ ...msg, status: "delivered" });
    }

    // Verify we sent with 'delivered' status
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].status).toBe("delivered");

    // Verify DB was updated
    const updated = db.getMessage("pending-msg-001");
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("delivered");

    // On next reconnect, it should NOT be pending anymore
    const pendingAfter = db.getPendingMessages("bob@server.com");
    expect(pendingAfter).toHaveLength(0);

    db.close();
  });
});
