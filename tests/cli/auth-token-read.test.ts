/**
 * Tests for the shared `readAuthToken()` helper.
 *
 * Phase: feat/bounty-task-optimize
 * 设计动机: `readAuthToken()` 原本内嵌在 `com/send.ts`，只能被 com/* 命令使用。
 * 现在抽出到 `src/cli/lib/auth-token.ts`，让 bounty-task/* 也能复用。
 *
 * API 设计: `readAuthToken(tokenPath?)`
 * - 不传参数: 默认读 ~/.config/bounty/token
 * - 传参数: 用作 DI for testing, 不污染真实 ~/
 *
 * 测试场景：
 * 1. 模块存在 + 默认导出 readAuthToken
 * 2. 当指定路径的 token 文件存在且非空时返回 string
 * 3. 当指定路径的 token 文件不存在时返回 undefined（不抛错）
 * 4. 当 token 文件存在但为空字符串时返回 undefined
 * 5. 当 token 文件包含前后空白时被 trim
 *
 * Profile 优先级测试（PR1 新增）：
 * 6. ProfileContext 有 token 时优先于文件
 * 7. ProfileContext 无 token 时回退到文件
 * 8. 没有 context + 没有 file + 设了 BOUNTY_TOKEN env → undefined（**确认 env 移除**）
 * 9. 显式 tokenPath 仍然可用（向后兼容 bounty-http / soft-auth）
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('readAuthToken - extracted helper', () => {
  let tempDir: string;
  let tokenPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `bounty-auth-token-test-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
    tokenPath = join(tempDir, 'token');
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test('exports readAuthToken function from src/cli/lib/auth-token.ts', async () => {
    const mod = await import('../../src/cli/lib/auth-token.js');
    expect(typeof mod.readAuthToken).toBe('function');
  });

  test('returns the token string when token file exists and has content', async () => {
    const testToken = 'eyJhbGciOiJIUzI1NiJ9.test-payload.valid-signature';
    writeFileSync(tokenPath, testToken, 'utf-8');

    const { readAuthToken } = await import('../../src/cli/lib/auth-token.js');
    const result = readAuthToken(tokenPath);
    expect(result).toBe(testToken);
  });

  test('returns undefined when token file does not exist (no throw)', async () => {
    expect(existsSync(tokenPath)).toBe(false);

    const { readAuthToken } = await import('../../src/cli/lib/auth-token.js');
    expect(() => readAuthToken(tokenPath)).not.toThrow();
    expect(readAuthToken(tokenPath)).toBeUndefined();
  });

  test('returns undefined when token file is empty', async () => {
    writeFileSync(tokenPath, '', 'utf-8');

    const { readAuthToken } = await import('../../src/cli/lib/auth-token.js');
    expect(readAuthToken(tokenPath)).toBeUndefined();
  });

  test('trims leading/trailing whitespace from token', async () => {
    const testToken = 'eyJhbGciOiJIUzI1NiJ9.trimmed-token';
    writeFileSync(tokenPath, `  \n${testToken}\n  `, 'utf-8');

    const { readAuthToken } = await import('../../src/cli/lib/auth-token.js');
    const result = readAuthToken(tokenPath);
    expect(result).toBe(testToken);
  });
});

// =====================================================================
// PR1: ProfileContext priority + BOUNTY_TOKEN env removal
// =====================================================================
//
// These tests cover the post-PR1 behavior of readAuthToken():
//   1. ProfileContext token wins over the on-disk token file
//   2. ProfileContext empty token falls back to the on-disk token file
//   3. With no context and no file, BOUNTY_TOKEN env is **ignored**
//      (PR1 explicitly removes this env var from the CLI auth path)
//   4. Explicit tokenPath argument still works for callers like
//      bounty-http and soft-auth that pass their own path
//
// Test isolation:
//   - ProfileContext is a module-scoped singleton. We import it once
//     and reset it to null in afterEach so each case starts clean.
//   - The token file lives in a per-test tempDir so no test mutates
//     the user's real ~/.config/bounty/token.
//   - We mutate process.env.BOUNTY_TOKEN in one test and restore it
//     in afterEach so we don't leak env state into other tests.

describe('readAuthToken - ProfileContext priority (PR1)', () => {
  let tempDir: string;
  let tokenPath: string;
  const originalBountyToken = process.env.BOUNTY_TOKEN;

  beforeEach(() => {
    tempDir = join(tmpdir(), `bounty-auth-token-priority-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
    tokenPath = join(tempDir, 'token');

    // Reset ProfileContext before each test so context-driven behavior
    // is deterministic. We import lazily so test ordering does not
    // matter.
  });

  afterEach(async () => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    // Restore BOUNTY_TOKEN exactly as we found it.
    if (originalBountyToken === undefined) {
      delete process.env.BOUNTY_TOKEN;
    } else {
      process.env.BOUNTY_TOKEN = originalBountyToken;
    }
    // Clear ProfileContext so subsequent tests start with no active profile.
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    ProfileContext.clear();
  });

  test('ProfileContext access_token wins over the on-disk token file', async () => {
    const { readAuthToken } = await import('../../src/cli/lib/auth-token.js');
    const { ProfileContext } = await import('../../src/cli/config/context.js');

    // On-disk file would normally win in pre-PR1 behavior.
    writeFileSync(tokenPath, 'file-token-should-be-ignored', 'utf-8');

    // Set ProfileContext with a different token.
    ProfileContext.setActive({
      name: 'priority-test',
      api_base: 'http://localhost:0',
      auth: { type: 'jwt', access_token: 'context-token-wins' },
      created_at: 0,
      updated_at: 0,
    });

    const result = readAuthToken(tokenPath);
    expect(result).toBe('context-token-wins');
  });

  test('ProfileContext without access_token falls back to the on-disk token file', async () => {
    const { readAuthToken } = await import('../../src/cli/lib/auth-token.js');
    const { ProfileContext } = await import('../../src/cli/config/context.js');

    const fileToken = 'fallback-file-token';
    writeFileSync(tokenPath, fileToken, 'utf-8');

    // Profile exists but has no access_token (e.g., user logged out).
    ProfileContext.setActive({
      name: 'no-token-profile',
      api_base: 'http://localhost:0',
      auth: { type: 'jwt' }, // no access_token
      created_at: 0,
      updated_at: 0,
    });

    const result = readAuthToken(tokenPath);
    expect(result).toBe(fileToken);
  });

  test('NO ProfileContext + NO file + BOUNTY_TOKEN env set -> returns undefined (env removed)', async () => {
    // CRITICAL: This test proves the BOUNTY_TOKEN env fallback is gone.
    // Pre-PR1: readAuthToken() would read process.env.BOUNTY_TOKEN and return it.
    // Post-PR1: even with env set, no context + no file = undefined.
    const { readAuthToken } = await import('../../src/cli/lib/auth-token.js');
    const { ProfileContext } = await import('../../src/cli/config/context.js');

    process.env.BOUNTY_TOKEN = 'env-token-should-be-ignored';
    ProfileContext.clear();
    expect(existsSync(tokenPath)).toBe(false);

    const result = readAuthToken(tokenPath);
    expect(result).toBeUndefined();
  });

  test('explicit tokenPath still works (back-compat for bounty-http / soft-auth)', async () => {
    // bounty-http and soft-auth pass their own tokenPath to readAuthToken.
    // PR1 must not break that contract — explicit path still reads the file.
    const { readAuthToken } = await import('../../src/cli/lib/auth-token.js');
    const { ProfileContext } = await import('../../src/cli/config/context.js');

    const explicitToken = 'explicit-path-token';
    writeFileSync(tokenPath, explicitToken, 'utf-8');

    ProfileContext.clear(); // No context, so the file path is the only source.

    const result = readAuthToken(tokenPath);
    expect(result).toBe(explicitToken);
  });
});