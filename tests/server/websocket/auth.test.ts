/**
 * PR4 — WebSocket upgrade auth contract (consolidated)
 *
 * BOUNTY_WS_AUTH_REQUIRED feature flag 控制 WS upgrade 是否要求 token:
 * - 默认 (env 未设 / =false): 不强制鉴权 (向后兼容)
 * - =true/1: 强制要求 Authorization: Bearer <valid-jwt>
 *   - 没 header → 401 JSON
 *   - 坏 token → 401 JSON
 *   - 合法 token → upgrade 成功 (server returns upgrade response)
 *
 * DI seam: constructor 接受 wsAuthRequired?: boolean 覆盖 env。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { BountyHTTPServer } from '../../../src/server/http/index.js';
import { IMDatabase } from '../../../src/im/db/index.js';
import { Database } from '../../../src/lib/storage/database.js';
import { createToken } from '../../../src/auth/jwt.js';

function makeImDb(): IMDatabase {
  return new IMDatabase({ memory: true });
}

async function upgradeRequest(baseUrl: string, token?: string): Promise<Response> {
  // 通过 fetch 模拟 WS upgrade — Bun.serve 在 /ws 路径会拒绝非 upgrade 请求,
  // 这里我们直接走 fetch 路径并观察 status。
  // 由于 WS upgrade 用普通 fetch 也由同一 handleRequest 处理, wsAuthRequired=true 时
  // 会直接返回 401 (不会真的升级)。
  const headers: Record<string, string> = {
    Upgrade: 'websocket',
    Connection: 'Upgrade',
    'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
    'Sec-WebSocket-Version': '13',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return await fetch(`${baseUrl}/ws?address=test@bounty.local`, { headers });
}

describe('PR4 WebSocket upgrade auth', () => {
  let originalWsEnv: string | undefined;

  beforeEach(() => {
    originalWsEnv = process.env.BOUNTY_WS_AUTH_REQUIRED;
    delete process.env.BOUNTY_WS_AUTH_REQUIRED;
  });

  afterEach(() => {
    if (originalWsEnv === undefined) {
      delete process.env.BOUNTY_WS_AUTH_REQUIRED;
    } else {
      process.env.BOUNTY_WS_AUTH_REQUIRED = originalWsEnv;
    }
  });

  describe('DI seam (constructor overrides env)', () => {
    test('constructor wsAuthRequired:true 覆盖 env=false', () => {
      process.env.BOUNTY_WS_AUTH_REQUIRED = 'false';
      const srv = new BountyHTTPServer({
        imDb: makeImDb() as any,
        bountyDb: new Database({ memory: true }) as any,
        port: 0,
        wsAuthRequired: true,
      });
      expect((srv as any).wsAuthRequired).toBe(true);
    });

    test('constructor wsAuthRequired:false 覆盖 env=true', () => {
      process.env.BOUNTY_WS_AUTH_REQUIRED = 'true';
      const srv = new BountyHTTPServer({
        imDb: makeImDb() as any,
        bountyDb: new Database({ memory: true }) as any,
        port: 0,
        wsAuthRequired: false,
      });
      expect((srv as any).wsAuthRequired).toBe(false);
    });
  });

  describe('默认 (env 未设): WS upgrade 不强制鉴权', () => {
    test('BOUNTY_WS_AUTH_REQUIRED 未设 → wsAuthRequired = false', () => {
      delete process.env.BOUNTY_WS_AUTH_REQUIRED;
      const srv = new BountyHTTPServer({
        imDb: makeImDb() as any,
        bountyDb: new Database({ memory: true }) as any,
        port: 0,
      });
      expect((srv as any).wsAuthRequired).toBe(false);
    });

    test('BOUNTY_WS_AUTH_REQUIRED=false → wsAuthRequired = false', () => {
      process.env.BOUNTY_WS_AUTH_REQUIRED = 'false';
      const srv = new BountyHTTPServer({
        imDb: makeImDb() as any,
        bountyDb: new Database({ memory: true }) as any,
        port: 0,
      });
      expect((srv as any).wsAuthRequired).toBe(false);
    });
  });

  describe('BOUNTY_WS_AUTH_REQUIRED=true: WS upgrade 强制鉴权', () => {
    let srv: BountyHTTPServer;
    let baseUrl: string;

    beforeEach(() => {
      process.env.BOUNTY_WS_AUTH_REQUIRED = 'true';
      srv = new BountyHTTPServer({
        imDb: makeImDb() as any,
        bountyDb: new Database({ memory: true }) as any,
        port: 0,
      });
    });

    afterEach(() => {
      if (srv) srv.stop();
    });

    test('无 Authorization 头 → 401', async () => {
      await srv.start();
      baseUrl = `http://localhost:${srv.getPort()}`;
      const res = await upgradeRequest(baseUrl);
      expect(res.status).toBe(401);
      const body = (await res.json()) as { event?: string; data?: { message?: string } };
      expect(body.data?.message ?? body.event).toMatch(/Authorization|token/i);
    });

    test('坏 token → 401', async () => {
      await srv.start();
      baseUrl = `http://localhost:${srv.getPort()}`;
      const res = await upgradeRequest(baseUrl, 'not.a.real.jwt');
      expect(res.status).toBe(401);
    });

    test('合法 token → upgrade 不被拒 (走通鉴权后由 Bun.serve 处理 upgrade)', async () => {
      await srv.start();
      baseUrl = `http://localhost:${srv.getPort()}`;
      const token = await createToken({ sub: 'ws-test-agent' });
      const res = await upgradeRequest(baseUrl, token);
      // 合法 token 通过后,Bun.serve 接管 upgrade 流程,
      // 普通 fetch 会得到 101 (Switching Protocols) 或被框架直接 upgrade 而无 HTTP 响应
      // (成功路径的 status 不会是 401)
      expect(res.status).not.toBe(401);
    });
  });
});