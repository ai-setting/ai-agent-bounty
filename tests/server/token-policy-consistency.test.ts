/**
 * Token policy consistency — bounty vs IM routes (v0.9 audit)
 *
 * 合约:
 *   - BOUNTY_TOKEN_CHECK_ENABLED 默认 (false/未设): /api/tasks/* 与 /api/messages/* 都放行
 *     无 Authorization 头的请求 — server 端用 body.actorAddress 定位 actor。
 *   - BOUNTY_TOKEN_CHECK_ENABLED=true: /api/tasks/* 与 /api/messages/* 都需要
 *     Authorization: Bearer <valid-jwt>; 没 header → 401; 坏 token → 401。
 *
 * 这是 review/optimize 任务的核心断言: 两套接口必须使用同一策略, 不能有
 * drift — 例如 bounty 公开但 IM 要 token (或反之)。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { BountyHTTPServer } from '../../src/server/http/index.js';
import { IMDatabase } from '../../src/im/db/index.js';
import { Database } from '../../src/lib/storage/database.js';

async function makeStartedServer(): Promise<{
  server: BountyHTTPServer;
  baseUrl: string;
  bountyDb: Database;
  cleanup: () => void;
}> {
  const bountyDb = new Database({ memory: true });
  const imDb = new IMDatabase({ memory: true });
  const now = Date.now();
  bountyDb
    .prepare(
      `INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`
    )
    .run('uuid-tc-1', 'TAlice', 'tAlice@example.com', 'uuid-tc-1@bounty.local', now, now);

  const server = new BountyHTTPServer({ imDb, bountyDb, port: 0 });
  await server.start();
  const baseUrl = `http://localhost:${server.getPort()}`;
  return {
    server,
    baseUrl,
    bountyDb,
    cleanup: () => server.stop(),
  };
}

describe('Token policy consistency: bounty vs IM (v0.9 audit)', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.BOUNTY_TOKEN_CHECK_ENABLED;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
    } else {
      process.env.BOUNTY_TOKEN_CHECK_ENABLED = originalEnv;
    }
  });

  describe('默认 (env 未设) → token check 关闭: 两套接口行为一致', () => {
    test('bounty publish 不带 token 成功', async () => {
      delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
      const { baseUrl, cleanup } = await makeStartedServer();
      try {
        const res = await fetch(`${baseUrl}/api/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'audit-no-token-pub',
            description: 'D',
            reward: 1,
            type: 'writing',
            publisherAddress: 'uuid-tc-1@bounty.local',
          }),
        });
        expect(res.status).toBe(201);
      } finally {
        cleanup();
      }
    });

    test('IM send 不带 token 成功', async () => {
      delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
      const { baseUrl, cleanup } = await makeStartedServer();
      try {
        const res = await fetch(`${baseUrl}/api/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'sender@server.com',
            to: 'uuid-tc-1@bounty.local',
            content: { type: 'text', body: 'audit' },
          }),
        });
        expect(res.status).toBe(201);
      } finally {
        cleanup();
      }
    });

    test('bounty grab 不带 token 成功 (提供 agentAddress)', async () => {
      delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
      const { baseUrl, cleanup } = await makeStartedServer();
      try {
        // 先发一个任务
        const pub = await fetch(`${baseUrl}/api/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'audit-grab',
            description: 'D',
            reward: 1,
            type: 'writing',
            publisherAddress: 'uuid-tc-1@bounty.local',
          }),
        });
        const task = (await pub.json()) as { id: string };

        const grabRes = await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentAddress: 'uuid-tc-1@bounty.local' }),
        });
        // 注: publisherId 自抢会被 service 拒绝, 但 HTTP 路由接受 → 200/409 均合法
        expect([200, 400, 409]).toContain(grabRes.status);
      } finally {
        cleanup();
      }
    });
  });

  describe('BOUNTY_TOKEN_CHECK_ENABLED=true → token check 开启: 两套接口行为一致', () => {
    test('bounty publish 不带 token → 401', async () => {
      process.env.BOUNTY_TOKEN_CHECK_ENABLED = 'true';
      const { baseUrl, cleanup } = await makeStartedServer();
      try {
        const res = await fetch(`${baseUrl}/api/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'audit-bad-tok',
            description: 'D',
            reward: 1,
            type: 'writing',
            publisherAddress: 'uuid-tc-1@bounty.local',
          }),
        });
        expect(res.status).toBe(401);
      } finally {
        cleanup();
      }
    });

    test('IM send 不带 token → 401', async () => {
      process.env.BOUNTY_TOKEN_CHECK_ENABLED = 'true';
      const { baseUrl, cleanup } = await makeStartedServer();
      try {
        const res = await fetch(`${baseUrl}/api/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'sender@server.com',
            to: 'uuid-tc-1@bounty.local',
            content: { type: 'text', body: 'audit' },
          }),
        });
        expect(res.status).toBe(401);
      } finally {
        cleanup();
      }
    });

    test('bounty grab 不带 token → 401', async () => {
      process.env.BOUNTY_TOKEN_CHECK_ENABLED = 'true';
      const { baseUrl, cleanup } = await makeStartedServer();
      try {
        const grabRes = await fetch(`${baseUrl}/api/tasks/some-id/grab`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentAddress: 'uuid-tc-1@bounty.local' }),
        });
        expect(grabRes.status).toBe(401);
      } finally {
        cleanup();
      }
    });

    test('带坏 token 的请求仍被拒绝 (统一策略)', async () => {
      process.env.BOUNTY_TOKEN_CHECK_ENABLED = 'true';
      const { baseUrl, cleanup } = await makeStartedServer();
      try {
        const bountyRes = await fetch(`${baseUrl}/api/tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bad.token.here' },
          body: JSON.stringify({
            title: 'audit',
            description: 'D',
            reward: 1,
            type: 'writing',
            publisherAddress: 'uuid-tc-1@bounty.local',
          }),
        });
        expect(bountyRes.status).toBe(401);

        const imRes = await fetch(`${baseUrl}/api/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer bad.token.here' },
          body: JSON.stringify({
            from: 'sender@server.com',
            to: 'uuid-tc-1@bounty.local',
            content: { type: 'text', body: 'audit' },
          }),
        });
        expect(imRes.status).toBe(401);
      } finally {
        cleanup();
      }
    });
  });

  describe('策略切换无状态泄漏 (audit invariant)', () => {
    test('不同 server 实例各自读取 env 状态', async () => {
      // 实例 1: env off
      delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
      const r1 = await makeStartedServer();
      expect((r1.server as any).tokenCheckEnabled).toBe(false);
      r1.cleanup();

      // 实例 2: env on
      process.env.BOUNTY_TOKEN_CHECK_ENABLED = '1';
      const r2 = await makeStartedServer();
      expect((r2.server as any).tokenCheckEnabled).toBe(true);
      r2.cleanup();
    });
  });
});
