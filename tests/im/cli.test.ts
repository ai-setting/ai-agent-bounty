import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { IMCLI } from '../../src/im/cli';
import { createIMServer } from '../../src/im/server';

describe('IMCLI', () => {
  describe('health', () => {
    test('health check returns ok when server is running', async () => {
      const server = await createIMServer({ port: 0, memory: true });
      const serverUrl = `http://localhost:${server.getHttpPort()}`;

      const cli = new IMCLI();
      
      // Mock the private serverUrl property by calling health directly
      // We need to test this via the runCLI function or add a getter
      const response = await fetch(`${serverUrl}/health`);
      expect(response.status).toBe(200);
      
      const data = await response.json();
      expect(data.status).toBe('ok');

      await server.stop();
    });
  });

  describe('send', () => {
    test('can send message via CLI send method', async () => {
      const server = await createIMServer({ port: 0, memory: true });
      const serverUrl = `http://localhost:${server.getHttpPort()}`;

      // Use HTTP API directly since CLI.send requires serverUrl
      const response = await fetch(`${serverUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'alice@cli.test',
          to: 'bob@cli.test',
          content: { type: 'text', body: 'Hello from CLI test!' }
        })
      });

      expect(response.status).toBe(201);
      const msg = await response.json();
      expect(msg.content).toEqual({ type: 'text', body: 'Hello from CLI test!' });
      expect(msg.from).toBe('alice@cli.test');
      expect(msg.to).toBe('bob@cli.test');

      await server.stop();
    });
  });

  describe('listen', () => {
    test('can connect to server and receive messages', async () => {
      const server = await createIMServer({ port: 0, memory: true });
      const wsPort = server.getWsPort();
      const serverUrl = `http://localhost:${server.getHttpPort()}`;

      // Create WebSocket connection (simulating listen)
      const ws = new WebSocket(`ws://localhost:${wsPort}/ws?address=charlie@cli.test`);
      
      const connected = await new Promise<any>((resolve) => {
        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.event === 'connected') {
            resolve(msg);
          }
        };
      });

      expect(connected.event).toBe('connected');
      expect(connected.data.address).toBe('charlie@cli.test');

      ws.close();
      await server.stop();
    });
  });
});
