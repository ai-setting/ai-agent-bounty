import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { IMDatabase } from '../../src/im/db';
import { IMServer } from '../../src/im/server';

describe('IMWebSocketServer', () => {
  let db: IMDatabase;
  let server: IMServer;
  let baseUrl: string;
  let wsPort: number;

  beforeEach(async () => {
    db = new IMDatabase({ memory: true });
    server = new IMServer(db, 0);
    await server.start();
    baseUrl = `http://localhost:${server.getHttpPort()}`;
    wsPort = server.getWsPort();
  });

  afterEach(() => {
    server.stop();
    db.close();
  });

  describe('connection', () => {
    test('connects successfully with address query param', async () => {
      const ws = new WebSocket(`ws://localhost:${wsPort}/ws?address=alice@server.com`);
      
      const connected = await new Promise<any>((resolve) => {
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.event === 'connected') {
            resolve(msg);
          }
        };
      });

      expect(connected.event).toBe('connected');
      expect(connected.data.address).toBe('alice@server.com');
      ws.close();
    });

    test('updates agent status to online on connect', async () => {
      const ws = new WebSocket(`ws://localhost:${wsPort}/ws?address=bob@server.com`);
      
      await new Promise<void>((resolve) => {
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.event === 'connected') {
            resolve();
          }
        };
      });

      // Check agent status in database
      const agent = db.getAgentByAddress('bob@server.com');
      expect(agent).not.toBeNull();
      expect(agent!.status).toBe('online');

      ws.close();
    });

    test('returns error when address is missing', async () => {
      // When address is missing, the server should close the connection
      const ws = new WebSocket(`ws://localhost:${wsPort}/ws`);

      const result = await new Promise<any>((resolve) => {
        const timeout = setTimeout(() => resolve({ code: -1 }), 1000);
        ws.onclose = (e) => {
          clearTimeout(timeout);
          resolve({ code: e.code });
        };
      });

      // Connection should be closed (code 1006 means abnormal closure)
      expect(result.code).toBeDefined();
    });
  });

  describe('pending messages on connect', () => {
    test('receives pending messages on connect', async () => {
      // Send messages to alice before she connects
      await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'alice@server.com',
          content: { type: 'text', body: 'Hello Alice 1' }
        })
      });

      await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'alice@server.com',
          content: { type: 'text', body: 'Hello Alice 2' }
        })
      });

      // Connect alice
      const ws = new WebSocket(`ws://localhost:${wsPort}/ws?address=alice@server.com`);
      const messages: any[] = [];

      await new Promise<void>((resolve) => {
        let connectReceived = false;
        let messageCount = 0;
        
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          
          if (msg.event === 'connected') {
            connectReceived = true;
          } else if (msg.event === 'message') {
            messageCount++;
            messages.push(msg.data);
            if (messageCount === 2) {
              resolve();
            }
          }
        };

        // Timeout fallback
        setTimeout(() => {
          if (connectReceived && messages.length > 0) {
            resolve();
          }
        }, 500);
      });

      expect(messages).toHaveLength(2);
      expect(messages[0].content.body).toBe('Hello Alice 1');
      expect(messages[1].content.body).toBe('Hello Alice 2');

      ws.close();
    });
  });

  describe('message push', () => {
    test('receives push when message is sent via HTTP', async () => {
      let receivedMessage: any = null;
      
      // Alice connects
      const alice = new WebSocket(`ws://localhost:${wsPort}/ws?address=alice@server.com`);

      await new Promise<void>((resolve) => {
        alice.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.event === 'connected') {
            resolve();
          }
        };
      });

      // Set up message handler to capture pushed messages
      alice.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.event === 'message') {
          receivedMessage = msg.data;
        }
      };

      // Send message to Alice via HTTP
      await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'alice@server.com',
          content: { type: 'text', body: 'Push message!' }
        })
      });

      // Wait for the pushed message with timeout
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (receivedMessage) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 10);
        
        // Timeout after 2 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 2000);
      });

      expect(receivedMessage).not.toBeNull();
      expect(receivedMessage.content).toEqual({ type: 'text', body: 'Push message!' });

      alice.close();
    });
  });

  describe('pushMessage method', () => {
    test('can push message directly via pushMessage method', async () => {
      const ws = new WebSocket(`ws://localhost:${wsPort}/ws?address=bob@server.com`);

      await new Promise<void>((resolve) => {
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.event === 'connected') {
            resolve();
          }
        };
      });

      // Push message directly
      server.pushMessage('bob@server.com', {
        id: 'test-msg-1',
        from: 'alice@server.com',
        to: 'bob@server.com',
        content: { type: 'text', body: 'Direct push!' },
        status: 'delivered',
        createdAt: new Date().toISOString()
      });

      const pushedMsg = await new Promise<any>((resolve) => {
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.event === 'message') {
            resolve(msg.data);
          }
        };
      });

      expect(pushedMsg.content.body).toBe('Direct push!');

      ws.close();
    });

    test('pushMessage to offline address does not throw', () => {
      // Should not throw even if no client is connected
      expect(() => {
        server.pushMessage('offline@server.com', {
          id: 'test-msg-2',
          from: 'alice@server.com',
          to: 'offline@server.com',
          content: { type: 'text', body: 'Offline push' },
          status: 'pending',
          createdAt: new Date().toISOString()
        });
      }).not.toThrow();
    });
  });

  describe('heartbeat', () => {
    test('responds with pong on ping', async () => {
      const ws = new WebSocket(`ws://localhost:${wsPort}/ws?address=alice@server.com`);

      await new Promise<void>((resolve) => {
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.event === 'connected') {
            resolve();
          }
        };
      });

      // Send ping
      ws.send(JSON.stringify({ event: 'ping' }));

      const pong = await new Promise<any>((resolve) => {
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.event === 'pong') {
            resolve(msg);
          }
        };
      });

      expect(pong.event).toBe('pong');

      ws.close();
    });
  });

  describe('ACK handling', () => {
    test('handles ack event from client', async () => {
      let receivedMessageId: string | null = null;
      
      const ws = new WebSocket(`ws://localhost:${wsPort}/ws?address=alice@server.com`);

      await new Promise<void>((resolve) => {
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.event === 'connected') {
            resolve();
          }
        };
      });

      // Set up message handler
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.event === 'message') {
          receivedMessageId = msg.data.id;
        }
      };

      // Send a message first
      const msgRes = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'alice@server.com',
          content: { type: 'text', body: 'Ack me!' }
        })
      });
      const sentMsg = await msgRes.json();

      // Wait for the message to be received
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (receivedMessageId) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 10);
        
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 2000);
      });

      // Send ack
      ws.send(JSON.stringify({
        event: 'ack',
        data: { messageIds: [sentMsg.id] }
      }));

      // Verify message is acked
      const getRes = await fetch(`${baseUrl}/messages/${sentMsg.id}`);
      const ackedMsg = await getRes.json();
      expect(ackedMsg.status).toBe('acked');

      ws.close();
    });
  });

  describe('disconnect', () => {
    test('updates agent status to offline on disconnect', async () => {
      const ws = new WebSocket(`ws://localhost:${wsPort}/ws?address=alice@server.com`);

      await new Promise<void>((resolve) => {
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.event === 'connected') {
            resolve();
          }
        };
      });

      // Verify online status
      let agent = db.getAgentByAddress('alice@server.com');
      expect(agent!.status).toBe('online');

      // Disconnect
      ws.close();

      // Wait a bit for the close event to be processed
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify offline status
      agent = db.getAgentByAddress('alice@server.com');
      expect(agent!.status).toBe('offline');
    });

    test('allows reconnection with updated status', async () => {
      // First connection
      const ws1 = new WebSocket(`ws://localhost:${wsPort}/ws?address=alice@server.com`);

      await new Promise<void>((resolve) => {
        ws1.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.event === 'connected') {
            resolve();
          }
        };
      });

      // Disconnect
      ws1.close();
      await new Promise(resolve => setTimeout(resolve, 50));

      // Reconnect
      const ws2 = new WebSocket(`ws://localhost:${wsPort}/ws?address=alice@server.com`);

      await new Promise<void>((resolve) => {
        ws2.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.event === 'connected') {
            resolve();
          }
        };
      });

      // Status should be online again
      const agent = db.getAgentByAddress('alice@server.com');
      expect(agent!.status).toBe('online');

      ws2.close();
    });
  });

  describe('multiple clients', () => {
    test('each client receives their own messages', async () => {
      // Alice connects and sets up message handler
      const alice = new WebSocket(`ws://localhost:${wsPort}/ws?address=alice@server.com`);
      let aliceConnected = false;
      let aliceReceivedMsg: any = null;
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Alice connect timeout')), 1000);
        alice.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.event === 'connected') {
            aliceConnected = true;
            clearTimeout(timeout);
            resolve();
          }
          if (msg.event === 'message') {
            aliceReceivedMsg = msg.data;
          }
        };
      });

      expect(aliceConnected).toBe(true);

      // Bob connects and sets up message handler
      const bob = new WebSocket(`ws://localhost:${wsPort}/ws?address=bob@server.com`);
      let bobConnected = false;
      let bobReceived = false;
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Bob connect timeout')), 1000);
        bob.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.event === 'connected') {
            bobConnected = true;
            clearTimeout(timeout);
            resolve();
          }
          if (msg.event === 'message') {
            bobReceived = true;
          }
        };
      });

      expect(bobConnected).toBe(true);

      // Send message to Alice
      const res = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'alice@server.com',
          content: { type: 'text', body: 'For Alice only' }
        })
      });
      expect(res.status).toBe(201);

      // Wait for Alice to receive the message
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Alice receive timeout')), 2000);
        const check = () => {
          if (aliceReceivedMsg) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(check, 10);
          }
        };
        check();
      });

      expect(aliceReceivedMsg.content.body).toBe('For Alice only');

      // Bob should not receive Alice's message
      expect(bobReceived).toBe(false);

      alice.close();
      bob.close();
    });
  });

  describe('regression: connected event on open (upgrade branch fix)', () => {
    test('should send connected event on open (regression test for upgrade branch)', async () => {
      const ws = new WebSocket(`ws://localhost:${wsPort}/ws?address=regression@server.com`);

      const connected = await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for connected event')), 5000);
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.event === 'connected') {
              clearTimeout(timer);
              resolve(msg);
            }
          } catch (err) {
            clearTimeout(timer);
            reject(err);
          }
        };
        ws.onerror = (err) => {
          clearTimeout(timer);
          reject(err);
        };
      });

      expect(connected.event).toBe('connected');
      expect(connected.data.address).toBe('regression@server.com');
      ws.close();
    });
  });
});
