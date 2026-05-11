/**
 * Tests for com CLI commands
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createIMServer } from '../../src/im/server';

describe('com CLI Commands Integration', () => {
  let server: any;

  beforeEach(async () => {
    server = await createIMServer({ port: 0, memory: true });
  });

  afterEach(async () => {
    await server.stop();
  });

  describe('send command', () => {
    test('should send message via HTTP API', async () => {
      const port = server.getHttpPort();
      const response = await fetch(`http://localhost:${port}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'alice@cli.test',
          to: 'bob@cli.test',
          content: { type: 'text', body: 'Hello from com send!' }
        })
      });

      expect(response.status).toBe(201);
      const msg = await response.json();
      expect(msg.from).toBe('alice@cli.test');
      expect(msg.to).toBe('bob@cli.test');
      expect(msg.content).toEqual({ type: 'text', body: 'Hello from com send!' });
    });

    test('should reject message without to address', async () => {
      const port = server.getHttpPort();
      const response = await fetch(`http://localhost:${port}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'alice@cli.test',
          content: { type: 'text', body: 'Hello' }
        })
      });

      expect(response.status).toBe(400);
    });
  });

  describe('inbox command', () => {
    test('should get inbox messages', async () => {
      const port = server.getHttpPort();
      
      // First send a message
      await fetch(`http://localhost:${port}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'alice@cli.test',
          to: 'bob@cli.test',
          content: { type: 'text', body: 'Test message' }
        })
      });

      // Then get inbox
      const response = await fetch(`http://localhost:${port}/messages?address=bob@cli.test`);
      expect(response.status).toBe(200);
      
      const messages = await response.json();
      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBe(1);
      expect(messages[0].to).toBe('bob@cli.test');
    });

    test('should return empty array for empty inbox', async () => {
      const port = server.getHttpPort();
      const response = await fetch(`http://localhost:${port}/messages?address=empty@cli.test`);
      expect(response.status).toBe(200);
      
      const messages = await response.json();
      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBe(0);
    });
  });

  describe('config command', () => {
    test('should verify server health', async () => {
      const port = server.getHttpPort();
      const response = await fetch(`http://localhost:${port}/health`);
      expect(response.status).toBe(200);
      
      const health = await response.json();
      expect(health.status).toBe('ok');
    });
  });

  describe('connect command', () => {
    test('should connect via WebSocket', async () => {
      const wsPort = server.getWsPort();
      const ws = new WebSocket(`ws://localhost:${wsPort}/ws?address=tester@cli.test`);
      
      const connected = await new Promise<any>((resolve) => {
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.event === 'connected') {
            resolve(msg);
          }
        };
      });

      expect(connected.event).toBe('connected');
      expect(connected.data.address).toBe('tester@cli.test');
      ws.close();
    });
  });
});
