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