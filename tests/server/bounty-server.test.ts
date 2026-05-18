import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { BountyHTTPServer } from '../../src/server/http';
import { IMDatabase } from '../../src/im/db';
import type { Message } from '../../src/im/types';

/**
 * Integration tests for BountyHTTPServer
 * Tests real-time message push via WebSocket
 */
describe('BountyHTTPServer Integration', () => {
  let server: BountyHTTPServer;
  let db: IMDatabase;
  let port: number;

  beforeEach(() => {
    db = new IMDatabase({ memory: true });
    server = new BountyHTTPServer({
      imDb: db,
      port: 0, // Random available port
    });

    // Set push callback - this is the fix for real-time message push
    server.setPushCallback((address, message) => {
      server.pushMessage(address, message);
    });

    server.start();
    port = server.getPort();
  });

  afterEach(() => {
    server.stop();
    db.close();
  });

  test('real-time message push via HTTP API', async () => {
    // Bob connects first
    const bobWs = new WebSocket(`ws://localhost:${port}/ws?address=bob@server.com`);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Bob connect timeout')), 1000);
      bobWs.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.event === 'connected') {
          clearTimeout(timeout);
          resolve();
        }
      };
    });

    // Set up message listener
    let receivedMessage: Message | null = null;
    bobWs.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.event === 'message') {
        receivedMessage = msg.data;
      }
    };

    // Alice sends message via HTTP API
    const res = await fetch(`http://localhost:${port}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'alice@server.com',
        to: 'bob@server.com',
        content: { type: 'text', body: 'Hello Bob!' }
      })
    });

    expect(res.status).toBe(201);

    // Bob should receive the message in real-time
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Bob receive timeout')), 1000);
      const check = () => {
        if (receivedMessage) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });

    expect(receivedMessage!.content).toEqual({ type: 'text', body: 'Hello Bob!' });
    expect(receivedMessage!.from).toBe('alice@server.com');
    expect(receivedMessage!.to).toBe('bob@server.com');

    bobWs.close();
  });

  test('only pending messages are sent on reconnect', async () => {
    // Send messages to offline Bob
    await fetch(`http://localhost:${port}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'alice@server.com',
        to: 'bob@server.com',
        content: { type: 'text', body: 'Message 1' }
      })
    });

    // Bob connects
    const bobWs = new WebSocket(`ws://localhost:${port}/ws?address=bob@server.com`);

    let receivedMessages: Message[] = [];
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Bob connect timeout')), 1000);
      bobWs.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.event === 'connected') {
          // Wait a bit to collect all pending messages
          setTimeout(() => {
            clearTimeout(timeout);
            resolve();
          }, 50);
        }
        if (msg.event === 'message') {
          receivedMessages.push(msg.data);
        }
      };
    });

    // Bob should receive only the pending message
    expect(receivedMessages).toHaveLength(1);
    expect(receivedMessages[0].content).toEqual({ type: 'text', body: 'Message 1' });

    // Check message status in DB
    const inbox = db.getInbox('bob@server.com');
    expect(inbox).toHaveLength(1);
    expect(inbox[0].status).toBe('delivered');

    // Bob disconnects
    bobWs.close();

    // Wait for disconnect to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // Bob reconnects
    const bobWs2 = new WebSocket(`ws://localhost:${port}/ws?address=bob@server.com`);

    let receivedMessagesOnReconnect: Message[] = [];
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Bob reconnect timeout')), 1000);
      bobWs2.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.event === 'connected') {
          setTimeout(() => {
            clearTimeout(timeout);
            resolve();
          }, 50);
        }
        if (msg.event === 'message') {
          receivedMessagesOnReconnect.push(msg.data);
        }
      };
    });

    // Bob should NOT receive the message again - it was already delivered
    expect(receivedMessagesOnReconnect).toHaveLength(0);

    bobWs2.close();
  });

  test('WebSocket message also triggers real-time push', async () => {
    // Bob connects
    const bobWs = new WebSocket(`ws://localhost:${port}/ws?address=bob@server.com`);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Bob connect timeout')), 1000);
      bobWs.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.event === 'connected') {
          clearTimeout(timeout);
          resolve();
        }
      };
    });

    // Set up message listener
    let receivedMessage: Message | null = null;
    bobWs.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.event === 'message') {
        receivedMessage = msg.data;
      }
    };

    // Alice connects
    const aliceWs = new WebSocket(`ws://localhost:${port}/ws?address=alice@server.com`);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Alice connect timeout')), 1000);
      aliceWs.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.event === 'connected') {
          clearTimeout(timeout);
          resolve();
        }
      };
    });

    // Alice sends message via WebSocket
    aliceWs.send(JSON.stringify({
      event: 'message',
      data: {
        to: 'bob@server.com',
        content: { type: 'text', body: 'Hello from WebSocket!' }
      }
    }));

    // Bob should receive the message
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Bob receive timeout')), 1000);
      const check = () => {
        if (receivedMessage) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });

    expect(receivedMessage!.content).toEqual({ type: 'text', body: 'Hello from WebSocket!' });

    aliceWs.close();
    bobWs.close();
  });
});
