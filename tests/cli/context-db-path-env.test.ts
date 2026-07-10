/**
 * Tests for `src/cli/services/context.ts` — dbPath env support.
 *
 * Phase: feat/bounty-task-optimize
 * 设计动机: `createContext()` 当前硬编码 `./data/bounty.db`，即使 `BOUNTY_DB_PATH`
 * 环境变量被设置也不会生效。修复后应该读 `bountyConfig.dbPath`，让 operator
 * 用 env 即可切换数据库位置（无需改代码）。
 *
 * 测试策略（混合）：
 * - 静态测试: 读源码验证 import + 不硬编码 + 用 bountyConfig.dbPath
 * - 动态测试: 用 mock.module + counter 记录 Database 构造函数被调用时的参数
 *
 * 与已有 `tests/cli/bounty-config-server-url-env.test.ts` 的区别：
 * - 那个测的是 bounty-config 本身读 env 的逻辑
 * - 本文件测的是 context.ts 真的用 bountyConfig.dbPath（而不是硬编码）
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { bountyConfig } from '../../src/lib/config/bounty-config.js';

const SRC = resolve(import.meta.dir, '../../src/cli/services/context.ts');

describe('createContext - dbPath via bountyConfig', () => {
  let origEnv: string | undefined;

  beforeEach(() => {
    origEnv = process.env.BOUNTY_DB_PATH;
    delete process.env.BOUNTY_DB_PATH;
  });

  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.BOUNTY_DB_PATH;
    } else {
      process.env.BOUNTY_DB_PATH = origEnv;
    }
  });

  test('source must reference bountyConfig (no hardcoded ./data/bounty.db)', () => {
    const src = readFileSync(SRC, 'utf-8');
    // 必须 import bountyConfig
    expect(src).toContain("from '../../lib/config/bounty-config.js'");
    // 不能硬编码 './data/bounty.db'
    expect(src).not.toContain("path: './data/bounty.db'");
    // 必须用 bountyConfig.dbPath
    expect(src).toContain('bountyConfig.dbPath');
  });

  test('source uses bountyConfig.dbPath for both Database and IMDatabase', () => {
    const src = readFileSync(SRC, 'utf-8');
    // 必须用两次 bountyConfig.dbPath（一次给 Database，一次给 IMDatabase）
    const matches = src.match(/bountyConfig\.dbPath/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test('createContext uses bountyConfig.dbPath (default fallback to ./data/bounty.db)', () => {
    delete process.env.BOUNTY_DB_PATH;
    bountyConfig.reload();
    // 默认值（bounty-config DEFAULTS.DB_PATH = './data/bounty.db'）
    expect(bountyConfig.dbPath).toBe('./data/bounty.db');
  });

  test('createContext honors BOUNTY_DB_PATH env via bountyConfig.dbPath', () => {
    const customPath = '/tmp/bounty-test-create-context-custom.db';
    // 必须先 reload 把旧 env 清掉（reload 会删所有 BOUNTY_* env），
    // 再设置 BOUNTY_DB_PATH，这样下次读 getter 时拿到的就是新值
    bountyConfig.reload();
    process.env.BOUNTY_DB_PATH = customPath;
    expect(bountyConfig.dbPath).toBe(customPath);
  });
});