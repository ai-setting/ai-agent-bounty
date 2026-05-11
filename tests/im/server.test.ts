import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { IMHTTPServer } from '../../src/im/server/http';
import { IMDatabase } from '../../src/im/db';

describe('IMHTTPServer', () => {
  let db: IMDatabase;
  let server: IMHTTPServer;
  let baseUrl: string;

  beforeEach(async () => {
    db = new IMDatabase({ memory: true });
    server = new IMHTTPServer(db, 0);
    await server.start();
    baseUrl = `http://localhost:${server.getPort()}`;
  });

  afterEach(() => {
    server.stop();
    db.close();
  });

  describe('GET /health', () => {
    test('returns health status', async () => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('status', 'ok');
      expect(body).toHaveProperty('timestamp');
      expect(typeof body.timestamp).toBe('number');
    });
  });

  describe('POST /messages', () => {
    test('creates a new message', async () => {
      const res = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'bob@server.com',
          content: { type: 'text', body: 'Hello!' }
        })
      });
      expect(res.status).toBe(201);
      const msg = await res.json();
      expect(msg).toHaveProperty('id');
      expect(msg.from).toBe('anonymous@server.com');
      expect(msg.to).toBe('bob@server.com');
      expect(msg.content).toEqual({ type: 'text', body: 'Hello!' });
      expect(msg.status).toBe('pending');
      expect(msg).toHaveProperty('createdAt');
    });

    test('accepts custom from address', async () => {
      const res = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'alice@server.com',
          to: 'bob@server.com',
          content: { type: 'text', body: 'Hi!' }
        })
      });
      expect(res.status).toBe(201);
      const msg = await res.json();
      expect(msg.from).toBe('alice@server.com');
    });

    test('returns 400 when to is missing', async () => {
      const res = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { type: 'text', body: 'Hello!' }
        })
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 when content is missing', async () => {
      const res = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'bob@server.com'
        })
      });
      expect(res.status).toBe(400);
    });

    test('returns 400 when request body is empty', async () => {
      const res = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: ''
      });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /messages', () => {
    test('returns empty inbox for new address', async () => {
      const res = await fetch(`${baseUrl}/messages?address=bob@server.com`);
      expect(res.status).toBe(200);
      const msgs = await res.json();
      expect(msgs).toEqual([]);
    });

    test('returns messages for address', async () => {
      // Send a message first
      await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'bob@server.com',
          content: { type: 'text', body: 'Test 1' }
        })
      });

      await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'bob@server.com',
          content: { type: 'text', body: 'Test 2' }
        })
      });

      const res = await fetch(`${baseUrl}/messages?address=bob@server.com`);
      expect(res.status).toBe(200);
      const msgs = await res.json();
      expect(msgs).toHaveLength(2);
      // Messages should be in descending order by createdAt
      expect(new Date(msgs[0].createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(msgs[1].createdAt).getTime()
      );
    });

    test('returns empty array when address is missing', async () => {
      const res = await fetch(`${baseUrl}/messages`);
      expect(res.status).toBe(200);
      const msgs = await res.json();
      expect(msgs).toEqual([]);
    });
  });

  describe('GET /messages/:id', () => {
    test('returns message by id', async () => {
      // Create a message
      const createRes = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'bob@server.com',
          content: { type: 'text', body: 'Find me!' }
        })
      });
      const created = await createRes.json();

      // Get by id
      const res = await fetch(`${baseUrl}/messages/${created.id}`);
      expect(res.status).toBe(200);
      const msg = await res.json();
      expect(msg.id).toBe(created.id);
      expect(msg.content).toEqual({ type: 'text', body: 'Find me!' });
    });

    test('returns 404 for non-existent message', async () => {
      const res = await fetch(`${baseUrl}/messages/non-existent-id`);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /messages/ack', () => {
    test('acks single message', async () => {
      // Create a message
      const createRes = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'bob@server.com',
          content: { type: 'text', body: 'Ack me!' }
        })
      });
      const created = await createRes.json();

      // Ack it
      const res = await fetch(`${baseUrl}/messages/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageIds: [created.id]
        })
      });
      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.success).toBe(true);
      expect(result.acked).toBe(1);

      // Verify message status
      const getRes = await fetch(`${baseUrl}/messages/${created.id}`);
      const msg = await getRes.json();
      expect(msg.status).toBe('acked');
    });

    test('acks multiple messages', async () => {
      // Create messages
      const msg1 = await (await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'bob@server.com',
          content: { type: 'text', body: 'Msg 1' }
        })
      })).json();

      const msg2 = await (await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'bob@server.com',
          content: { type: 'text', body: 'Msg 2' }
        })
      })).json();

      // Ack both
      const res = await fetch(`${baseUrl}/messages/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageIds: [msg1.id, msg2.id]
        })
      });
      const result = await res.json();
      expect(result.acked).toBe(2);
    });

    test('returns 400 when messageIds is missing', async () => {
      const res = await fetch(`${baseUrl}/messages/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      expect(res.status).toBe(400);
    });

    test('acks non-existent messages gracefully', async () => {
      const res = await fetch(`${baseUrl}/messages/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageIds: ['non-existent-1', 'non-existent-2']
        })
      });
      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.acked).toBe(0);
    });
  });
});
