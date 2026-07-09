/**
 * Tests for `bountyConfig.apiUrl` env fallback chain (Task #1735 v0.5.0).
 *
 * 目的：v0.5.0 起，`bountyConfig.apiUrl` 应该支持 `BOUNTY_SERVER_URL` 作为
 * `BOUNTY_API_URL` 的别名（向后兼容 + 更直观的命名）。
 *
 * 优先级（高 → 低）：
 *   1. `BOUNTY_API_URL`（v0.4.x 已有，向后兼容）
 *   2. `BOUNTY_SERVER_URL`（v0.5.0 新增别名）
 *   3. 默认 url（构造自 host:port）
 *
 * 注意：因为 `bountyConfig` 是单例 + 模块级 .env loader，必须在 isolated
 * process 中重置 `process.env` 才能稳定测试。这里使用 `BOUNTY_API_URL` /
 * `BOUNTY_SERVER_URL` 的字符串存在性 + 优先级源码检查 + 单元测试三种方式。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const BOUNTY_CONFIG_PATH = resolve(import.meta.dir, '../../src/lib/config/bounty-config.ts');

describe('bountyConfig.apiUrl env fallback chain', () => {
  test('source declares BOUNTY_API_URL in apiUrl getter (priority 1)', () => {
    const src = readFileSync(BOUNTY_CONFIG_PATH, 'utf-8');
    expect(src).toMatch(/BOUNTY_API_URL/);
  });

  test('source declares BOUNTY_SERVER_URL as fallback in apiUrl getter (priority 2, v0.5.0)', () => {
    const src = readFileSync(BOUNTY_CONFIG_PATH, 'utf-8');
    // 源码 apiUrl getter 必须同时读 BOUNTY_SERVER_URL
    expect(src).toContain('BOUNTY_SERVER_URL');
  });

  test('BOUNTY_API_URL appears before BOUNTY_SERVER_URL in apiUrl getter', () => {
    const src = readFileSync(BOUNTY_CONFIG_PATH, 'utf-8');
    const apiUrlIdx = src.indexOf('BOUNTY_API_URL');
    const serverUrlIdx = src.indexOf('BOUNTY_SERVER_URL');
    expect(apiUrlIdx).toBeGreaterThan(-1);
    expect(serverUrlIdx).toBeGreaterThan(-1);
    // BOUNTY_API_URL 应在 BOUNTY_SERVER_URL 之前（即更高优先级）
    expect(apiUrlIdx).toBeLessThan(serverUrlIdx);
  });

  test('apiUrl getter falls back to default (this.url) when no env set', () => {
    const src = readFileSync(BOUNTY_CONFIG_PATH, 'utf-8');
    // 验证 fallback 链：BOUNTY_API_URL || BOUNTY_SERVER_URL || this.url
    // 最简化：源码 apiUrl getter 应有 chained || pattern
    const apiUrlGetterMatch = src.match(/get apiUrl[^{]*{[^}]*}/s);
    expect(apiUrlGetterMatch).not.toBeNull();
    const body = apiUrlGetterMatch![0];
    expect(body).toContain('BOUNTY_API_URL');
    expect(body).toContain('BOUNTY_SERVER_URL');
    // fallback 必须是 `|| this.url` (default)
    expect(body).toMatch(/\|\|\s*this\.url/);
  });
});

describe('runtime: bountyConfig.apiUrl behavior with env vars', () => {
  // 隔离测试：在 beforeEach 中清除所有相关 env
  let savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv = {
      BOUNTY_API_URL: process.env.BOUNTY_API_URL,
      BOUNTY_SERVER_URL: process.env.BOUNTY_SERVER_URL,
      BOUNTY_URL: process.env.BOUNTY_URL,
    };
    delete process.env.BOUNTY_API_URL;
    delete process.env.BOUNTY_SERVER_URL;
    delete process.env.BOUNTY_URL;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('when BOUNTY_SERVER_URL is set (only), apiUrl returns it', async () => {
    process.env.BOUNTY_SERVER_URL = 'https://bounty.example.com:443';
    const mod = await import('../../src/lib/config/bounty-config.js');
    expect(mod.bountyConfig.apiUrl).toBe('https://bounty.example.com:443');
  });

  test('when both BOUNTY_API_URL and BOUNTY_SERVER_URL are set, BOUNTY_API_URL wins', async () => {
    process.env.BOUNTY_API_URL = 'https://api.example.com';
    process.env.BOUNTY_SERVER_URL = 'https://server.example.com';
    const mod = await import('../../src/lib/config/bounty-config.js');
    expect(mod.bountyConfig.apiUrl).toBe('https://api.example.com');
  });

  test('when neither is set, apiUrl falls back to default (http://localhost:4000)', async () => {
    const mod = await import('../../src/lib/config/bounty-config.js');
    // 默认值是 http://{BOUNTY_HOST||localhost}:{BOUNTY_PORT||4000}
    expect(mod.bountyConfig.apiUrl).toMatch(/^https?:\/\/localhost:\d+$/);
  });
});