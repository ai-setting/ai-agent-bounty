/**
 * Tests for Tier B `--json` and `--quiet` flags on bounty-task commands.
 *
 * Phase: feat/bounty-task-optimize (Tier B)
 *
 * 设计动机：
 * - `--json` 输出 JSON 结果，方便 agent 程序化解析
 * - `--quiet` 抑制装饰性输出（"✓ Task published", "  ID: ..." 之类的 box）
 *   保留 stderr 错误
 *
 * 测试场景：
 * 1. publish --json → stdout 是合法 JSON (含 task 完整字段)
 * 2. publish --quiet → stdout 不含装饰文字 (但仍然在 stderr 抛错)
 * 3. publish 无 flag → 默认装饰文字输出
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { createBountyTestServer, type BountyTestServerHandle } from '../../src/cli/lib/bounty-test-server.js';

describe('bounty bounty-task — Tier B --json / --quiet flags', () => {
  let server: BountyTestServerHandle;
  let consoleLogOutput: string[];
  let consoleErrorOutput: string[];
  let exitCode: number | null;
  let origLog: any;
  let origErr: any;
  let origExit: any;

  beforeEach(async () => {
    process.env.BOUNTY_IM_ADDRESS = '8de9b6aa-5781-4a65-be96-45185fb7c8b1@host.local';
    consoleLogOutput = [];
    consoleErrorOutput = [];
    exitCode = null;

    origLog = console.log;
    origErr = console.error;
    origExit = process.exit;

    console.log = (...args: any[]) => {
      consoleLogOutput.push(args.map(String).join(' '));
    };
    console.error = (...args: any[]) => {
      consoleErrorOutput.push(args.map(String).join(' '));
    };
    process.exit = ((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`EXIT_${code ?? 0}`);
    }) as any;

    server = await createBountyTestServer({
      port: 0,
      seedAgents: [{ id: '8de9b6aa-5781-4a65-be96-45185fb7c8b1', email: 'test@host', name: 'Test', credits: 500 }],
    });
  });

  afterEach(async () => {
    delete process.env.BOUNTY_IM_ADDRESS;
    console.log = origLog;
    console.error = origErr;
    process.exit = origExit;
    if (server) await server.stop();
  });

  // ===== publish --json =====

  test('publish --json → outputs valid JSON on stdout (no decorative text)', async () => {
    const { publishCommand } = await import(
      '../../src/cli/commands/bounty-task/publish.js'
    );

    await (publishCommand as any).handler({
      title: 'json test',
      description: 'a json test',
      type: 'coding',
      reward: 100,
      'server-url': server.baseUrl,
      json: true,
    });

    expect(consoleLogOutput).toHaveLength(1);
    const parsed = JSON.parse(consoleLogOutput[0]);
    expect(parsed.title).toBe('json test');
    expect(parsed.reward).toBe(100);
    expect(parsed.status).toBe('open');
    expect(parsed.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('publish (no flag) → decorative text on stdout (default behavior)', async () => {
    const { publishCommand } = await import(
      '../../src/cli/commands/bounty-task/publish.js'
    );

    await (publishCommand as any).handler({
      title: 'plain test',
      description: 'a plain test',
      type: 'coding',
      reward: 100,
      'server-url': server.baseUrl,
    });

    // Multiple console.log calls: header + ID + Title + ...
    expect(consoleLogOutput.length).toBeGreaterThan(1);
    const allOutput = consoleLogOutput.join('\n');
    expect(allOutput).toContain('Task published successfully');
    expect(allOutput).toContain('plain test');
  });

  test('publish --quiet → minimal output on stdout (no decoration)', async () => {
    const { publishCommand } = await import(
      '../../src/cli/commands/bounty-task/publish.js'
    );

    await (publishCommand as any).handler({
      title: 'quiet test',
      description: 'a quiet test',
      type: 'coding',
      reward: 100,
      'server-url': server.baseUrl,
      quiet: true,
    });

    // --quiet suppresses decorative output but may still print task ID
    // (so scripts can parse the task id for next steps)
    const allOutput = consoleLogOutput.join('\n');
    expect(allOutput).not.toContain('Task published successfully');
    expect(allOutput).not.toContain('Title:');
    expect(allOutput).not.toContain('Type:');
  });

  test('publish --json --quiet → JSON only (no decoration)', async () => {
    const { publishCommand } = await import(
      '../../src/cli/commands/bounty-task/publish.js'
    );

    await (publishCommand as any).handler({
      title: 'jq test',
      description: 'json + quiet',
      type: 'coding',
      reward: 100,
      'server-url': server.baseUrl,
      json: true,
      quiet: true,
    });

    expect(consoleLogOutput).toHaveLength(1);
    const parsed = JSON.parse(consoleLogOutput[0]);
    expect(parsed.title).toBe('jq test');
  });

  test('json-output helper: shouldJson and jsonOutput functions', async () => {
    const { shouldJson, jsonOutput } = await import(
      '../../src/cli/lib/json-output.js'
    );
    expect(shouldJson({ json: true })).toBe(true);
    expect(shouldJson({ json: false })).toBe(false);
    expect(shouldJson({})).toBe(false);

    jsonOutput({ hello: 'world' });
    expect(consoleLogOutput).toHaveLength(1);
    expect(JSON.parse(consoleLogOutput[0])).toEqual({ hello: 'world' });
  });
});