/**
 * Tests for publish command's large-description / streaming handling (D.3).
 *
 * Phase: feat/bounty-task-optimize (Tier D.3)
 *
 * 设计动机: agent 可能用 publish 提交整个设计文档 / 长 README (>50KB)。
 * 当前无显式限制 → fetch() 整段读内存 → timeout / OOM。
 *
 * 修复后：
 * - 客户端 `description.length > MAX_DESCRIPTION_BYTES` → 友好错误提示
 *   + 提示用 --description-file 标志
 * - 新增 `--description-file <path>` 选项：读文件内容作为 description
 * - 允许的 volume 上限：100KB（软限制），>100KB 仍允许（有些合法大任务）
 *
 * 测试场景：
 * 1. 短 description (< 50KB) 通过验证
 * 2. 长 description (> 50KB) 仍允许
 * 3. --description-file 路径存在 → 读文件内容
 * 4. --description-file 路径不存在 → 友好错误
 * 5. --description + --description-file 同时给 → --description 优先（明示）
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  createBountyTestServer,
  type BountyTestServerHandle,
} from '../../src/cli/lib/bounty-test-server.js';

describe('bounty bounty-task publish — large-payload handling (D.3)', () => {
  let tempDir: string;
  let exitCode: number | null = null;
  let consoleErrorOutput: string[] = [];
  let server: BountyTestServerHandle;
  let received: Array<{ description: string }> = [];

  beforeEach(async () => {
    tempDir = join(tmpdir(), `bounty-d3-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
    exitCode = null;
    consoleErrorOutput = [];
    received = [];
    process.env.BOUNTY_IM_ADDRESS = '';

    spyOn(console, 'error').mockImplementation((...args: any[]) => {
      consoleErrorOutput.push(args.map(String).join(' '));
    });
    spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`EXIT_${code ?? 0}`);
    }) as any);

    server = await createBountyTestServer({
      port: 0,
      // v0.10: seed agent id must be a valid UUID so strict uuid@host match works
      seedAgents: [{ id: '8de9b6aa-5781-4a65-be96-45185fb7c8b1', email: 'test@host.com', name: 'Test', credits: 500 }],
    });
  });

  afterEach(async () => {
    delete process.env.BOUNTY_IM_ADDRESS;
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    (console.error as any).mockRestore?.();
    (process.exit as any).mockRestore?.();
    if (server) await server.stop();
  });

  test('short description (< 50KB) goes through to server', async () => {
    const { publishCommand } = await import(
      '../../src/cli/commands/bounty-task/publish.js'
    );

    await (publishCommand as any).handler({
      title: 't',
      description: 'a'.repeat(10_000), // 10KB
      type: 'coding',
      reward: 100,
      'server-url': server.baseUrl,
        'publisher-email': 'test@host.com',
    });

    // Verify the task was created on the server with the right description
    const listRes = await fetch(`${server.baseUrl}/api/tasks`);
    const tasks = (await listRes.json()) as Array<{ description?: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.description?.length).toBe(10_000);
  });

  test('large description (~80KB) still allowed, content forwarded as-is', async () => {
    const { publishCommand } = await import(
      '../../src/cli/commands/bounty-task/publish.js'
    );

    await (publishCommand as any).handler({
      title: 'big task',
      description: 'b'.repeat(80_000), // 80KB
      type: 'coding',
      reward: 100,
      'server-url': server.baseUrl,
        'publisher-email': 'test@host.com',
    });

    const listRes = await fetch(`${server.baseUrl}/api/tasks`);
    const tasks = (await listRes.json()) as Array<{ description?: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.description?.length).toBe(80_000);
  });

  test('--description-file: reads file content as description', async () => {
    const filePath = join(tempDir, 'long-desc.md');
    const fileContent = 'c'.repeat(5_000);
    writeFileSync(filePath, fileContent, 'utf-8');

    const { publishCommand } = await import(
      '../../src/cli/commands/bounty-task/publish.js'
    );

    await (publishCommand as any).handler({
      title: 'from file',
      type: 'coding',
      reward: 100,
      'description-file': filePath,
      'server-url': server.baseUrl,
        'publisher-email': 'test@host.com',
    });

    const listRes = await fetch(`${server.baseUrl}/api/tasks`);
    const tasks = (await listRes.json()) as Array<{ description?: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.description).toBe(fileContent);
  });

  test('--description-file: missing file → friendly error + exit 2', async () => {
    const { publishCommand } = await import(
      '../../src/cli/commands/bounty-task/publish.js'
    );

    let thrown: any = null;
    try {
      await (publishCommand as any).handler({
        title: 't',
        type: 'coding',
        reward: 100,
        'description-file': join(tempDir, 'nope.md'),
        'server-url': server.baseUrl,
        'publisher-email': 'test@host.com',
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown?.message).toMatch(/EXIT_2/);
    expect(exitCode).toBe(2);
    expect(
      consoleErrorOutput.some(
        (s) => s.includes('--description-file') || s.includes('not found') || s.includes('Cannot read')
      )
    ).toBe(true);
  });

  test('--description wins when both --description and --description-file are given', async () => {
    const filePath = join(tempDir, 'desc.md');
    writeFileSync(filePath, 'file-content', 'utf-8');

    const { publishCommand } = await import(
      '../../src/cli/commands/bounty-task/publish.js'
    );

    await (publishCommand as any).handler({
      title: 't',
      description: 'inline-content',
      type: 'coding',
      reward: 100,
      'description-file': filePath,
      'server-url': server.baseUrl,
        'publisher-email': 'test@host.com',
    });

    const listRes = await fetch(`${server.baseUrl}/api/tasks`);
    const tasks = (await listRes.json()) as Array<{ description?: string }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.description).toBe('inline-content');
  });
});
