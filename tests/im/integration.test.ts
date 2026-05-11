import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { IMServer } from '../../src/im/server';
import { IMDatabase } from '../../src/im/db';
import type { Message } from '../../src/im/types';

describe('IM Integration', () => {
  describe('完整发送接收流程', () => {
    let db: IMDatabase;
    let server: IMServer;
    let httpPort: number;
    let wsPort: number;

    beforeEach(async () => {
      db = new IMDatabase({ memory: true });
      server = new IMServer(db, 0);
      await server.start();
      httpPort = server.getHttpPort();
      wsPort = server.getWsPort();
    });

    afterEach(() => {
      server.stop();
      db.close();
    });

    test('完整发送接收流程', async () => {
      // Alice 连接
      const aliceWs = new WebSocket(`ws://localhost:${wsPort}/ws?address=alice@server.com`);
      
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

      // Bob 连接
      const bobWs = new WebSocket(`ws://localhost:${wsPort}/ws?address=bob@server.com`);
      
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

      // 设置 Bob 的消息监听
      let bobReceivedMessage: Message | null = null;
      bobWs.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.event === 'message') {
          bobReceivedMessage = msg.data;
        }
      };

      // Alice 发送消息给 Bob
      const res = await fetch(`http://localhost:${httpPort}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'alice@server.com',
          to: 'bob@server.com',
          content: { type: 'text', body: 'Hello Bob!' }
        })
      });

      expect(res.status).toBe(201);
      const sentMsg = await res.json();
      expect(sentMsg.content).toEqual({ type: 'text', body: 'Hello Bob!' });

      // Bob 收到消息
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Bob receive timeout')), 1000);
        const check = () => {
          if (bobReceivedMessage) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(check, 10);
          }
        };
        check();
      });

      expect(bobReceivedMessage!.content).toEqual({ type: 'text', body: 'Hello Bob!' });
      expect(bobReceivedMessage!.from).toBe('alice@server.com');
      expect(bobReceivedMessage!.to).toBe('bob@server.com');

      // 清理
      aliceWs.close();
      bobWs.close();
    });

    test('离线消息会在连接时接收', async () => {
      // 发送消息给离线用户
      await fetch(`http://localhost:${httpPort}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'alice@server.com',
          to: 'charlie@server.com',
          content: { type: 'text', body: 'Message for offline Charlie' }
        })
      });

      // Charlie 连接
      const charlieWs = new WebSocket(`ws://localhost:${wsPort}/ws?address=charlie@server.com`);
      
      let receivedMessages: Message[] = [];
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Charlie connect timeout')), 1000);
        charlieWs.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.event === 'connected') {
            // 等待一会儿看是否有离线消息
            setTimeout(() => {
              clearTimeout(timeout);
              resolve();
            }, 100);
          }
          if (msg.event === 'message') {
            receivedMessages.push(msg.data);
          }
        };
      });

      expect(receivedMessages).toHaveLength(1);
      expect(receivedMessages[0].content).toEqual({ type: 'text', body: 'Message for offline Charlie' });

      charlieWs.close();
    });

    test('健康检查端点', async () => {
      const res = await fetch(`http://localhost:${httpPort}/health`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body).toHaveProperty('timestamp');
    });
  });
});

describe('IMServer', () => {
  test('createIMServer factory function exists', async () => {
    // Test that we can import createIMServer
    const { createIMServer } = await import('../../src/im/server');
    expect(typeof createIMServer).toBe('function');
  });
});
