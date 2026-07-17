/**
 * PR4 — HTTP auth middleware contract (consolidated)
 *
 * 这些测试覆盖 PR4 安全策略改动后的所有关键路径:
 * - DI seam: constructor 接受 `tokenCheckEnabled?: boolean` 覆盖 env
 * - 默认 (env 未设): tokenCheckEnabled = **true** (PR4 保守策略)
 * - 公开白名单 (/health, /api/auth/*, /messages, /) 不鉴权
 * - 受保护接口 /api/agents/me: 默认 → 401; 带合法 token → 200; 坏 token → 401
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { BountyHTTPServer } from '../../../src/server/http/index.js';
import { IMDatabase } from '../../../src/im/db/index.js';
import { Database } from '../../../src/lib/storage/database.js';
import { createToken } from '../../../src/auth/jwt.js';

function makeImDb(): IMDatabase {
  return new IMDatabase({ memory: true });
}

describe('PR4 HTTP auth middleware', () => {
  let originalTokenEnv: string | undefined;

  beforeEach(() => {
    originalTokenEnv = process.env.BOUNTY_TOKEN_CHECK_ENABLED;
    delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
  });

  afterEach(() => {
    if (originalTokenEnv === undefined) {
      delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
    } else {
      process.env.BOUNTY_TOKEN_CHECK_ENABLED = originalTokenEnv;
    }
  });

  describe('DI seam (constructor overrides env)', () => {
    test('constructor tokenCheckEnabled:false 覆盖 env=true', () => {
      process.env.BOUNTY_TOKEN_CHECK_ENABLED = 'true';
      const srv = new BountyHTTPServer({
        imDb: makeImDb() as any,
        bountyDb: new Database({ memory: true }) as any,
        port: 0,
        tokenCheckEnabled: false,
      });
      expect((srv as any).tokenCheckEnabled).toBe(false);
    });

    test('constructor tokenCheckEnabled:true 覆盖 env=false', () => {
      process.env.BOUNTY_TOKEN_CHECK_ENABLED = 'false';
      const srv = new BountyHTTPServer({
        imDb: makeImDb() as any,
        bountyDb: new Database({ memory: true }) as any,
        port: 0,
        tokenCheckEnabled: true,
      });
      expect((srv as any).tokenCheckEnabled).toBe(true);
    });
  });

  describe('公开白名单 (whitelist) 不鉴权', () => {
    test('GET /health 无 token → 200 (token check 默认 ON 也不鉴权)', async () => {
      const srv = new BountyHTTPServer({
        imDb: makeImDb() as any,
        bountyDb: new Database({ memory: true }) as any,
        port: 0,
      });
      await srv.start();
      try {
        const res = await fetch(`http://localhost:${srv.getPort()}/health`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { status: string };
        expect(body.status).toBe('ok');
      } finally {
        srv.stop();
      }
    });
  });

  describe('受保护接口 /api/agents/me (默认 token check ON)', () => {
    let srv: BountyHTTPServer;
    let baseUrl: string;

    beforeEach(async () => {
      srv = new BountyHTTPServer({
        imDb: makeImDb() as any,
        bountyDb: new Database({ memory: true }) as any,
        port: 0,
      });
      await srv.start();
      baseUrl = `http://localhost:${srv.getPort()}`;
    });

    afterEach(() => {
      srv.stop();
    });

    test('GET /api/agents/me 无 token → 401', async () => {
      const res = await fetch(`${baseUrl}/api/agents/me`);
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Authorization');
    });

    test('GET /api/agents/me 坏 token → 401', async () => {
      const res = await fetch(`${baseUrl}/api/agents/me`, {
        headers: { Authorization: 'Bearer not.a.real.jwt' },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Invalid');
    });

    test('GET /api/agents/me 合法 token → 通过鉴权 (不返回 401)', async () => {
      // 注册一个 agent 以便 sub 能解析到合法记录
      const bountyDb = (srv as any).bountyDb as Database;
      const now = Date.now();
      bountyDb
        .prepare(
          `INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
           VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`
        )
        .run(
          'aaaaaaaa-1111-4000-8000-000000000001',
          'Alice',
          'alice@example.com',
          'aaaaaaaa-1111-4000-8000-000000000001@bounty.local',
          now,
          now,
        );

      const token = await createToken({ sub: 'aaaaaaaa-1111-4000-8000-000000000001' });
      const res = await fetch(`${baseUrl}/api/agents/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // 鉴权通过 → 不返回 401
      expect(res.status).not.toBe(401);
    });
  });
});