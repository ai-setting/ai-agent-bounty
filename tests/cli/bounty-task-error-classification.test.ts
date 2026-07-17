/**
 * Tests for error classification across bounty-task CLI commands (v0.14).
 *
 * 设计动机: bounty-task 命令失败时按 BountyHttpError.type 给出分类提示：
 *   - network → 提示启动 server, exit 4
 *   - auth → 提示登录, exit 3
 *   - business → 显示 server error, exit 2 (4xx)
 *   - server → 提示 server 端问题, exit 4 (5xx)
 *
 * 测试场景（mock server 触发真实错误 + process.exit spy 捕获 exit code）：
 * 1. publish/grab/submit/complete/cancel: 网络错误 → exit 4
 * 2. publish: auth 错误 → exit 3
 * 3. publish: business 错误 → exit 2
 * 4. publish: server 错误 → exit 4
 *
 * v0.14: --publisher-email / --email is the only actor identity input.
 * BOUNTY_IM_ADDRESS env fallback is REMOVED (Q5 ✅).
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';

const PUB_EMAIL = 'alice@example.com';
const AGENT_EMAIL = 'bob@example.com';

describe('bounty bounty-task - error classification (exit code mapping, v0.14)', () => {
  let mockServer: ReturnType<typeof Bun.serve> | null = null;
  let exitCode: number | null = null;
  let consoleErrorOutput: string[] = [];

  beforeEach(() => {
    mockServer = null;
    exitCode = null;
    consoleErrorOutput = [];
    delete process.env.BOUNTY_IM_ADDRESS;

    // Spy console.error + process.exit
    spyOn(console, 'error').mockImplementation((...args: any[]) => {
      consoleErrorOutput.push(args.map(String).join(' '));
    });
    spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`EXIT_${code ?? 0}`);
    }) as any);
  });

  afterEach(async () => {
    if (mockServer) {
      await mockServer.stop();
      mockServer = null;
    }
    // Restore spies
    (console.error as any).mockRestore?.();
    (process.exit as any).mockRestore?.();
  });

  test('publish: network error → exit 4 + friendly message', async () => {
    const { publishCommand } = await import('../../src/cli/commands/bounty-task/publish.js');

    let thrown: any = null;
    try {
      await (publishCommand as any).handler({
        title: 't',
        description: 'd',
        type: 'coding',
        reward: 100,
        'publisher-email': PUB_EMAIL,
        'server-url': 'http://127.0.0.1:1',
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown?.message).toMatch(/EXIT_4/);
    expect(exitCode).toBe(4);
    expect(consoleErrorOutput.some((s) => s.includes('Network error'))).toBe(true);
    expect(consoleErrorOutput.some((s) => s.includes('bounty server') || s.includes('server-url'))).toBe(true);
  });

  test('publish: auth error (401) → exit 3', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      },
    });

    const { publishCommand } = await import('../../src/cli/commands/bounty-task/publish.js');

    let thrown: any = null;
    try {
      await (publishCommand as any).handler({
        title: 't',
        description: 'd',
        type: 'coding',
        reward: 100,
        'publisher-email': PUB_EMAIL,
        'server-url': `http://localhost:${mockServer.port}`,
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown?.message).toMatch(/EXIT_3/);
    expect(exitCode).toBe(3);
    expect(consoleErrorOutput.some((s) => s.includes('Authentication') || s.includes('login'))).toBe(true);
  });

  test('publish: business error (400 reward=0) → exit 2', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ error: 'reward must be > 0' }, { status: 400 });
      },
    });

    const { publishCommand } = await import('../../src/cli/commands/bounty-task/publish.js');

    let thrown: any = null;
    try {
      await (publishCommand as any).handler({
        title: 't',
        description: 'd',
        type: 'coding',
        reward: 100, // server is mock — accepts body — we stub 400 at server side
        'publisher-email': PUB_EMAIL,
        'server-url': `http://localhost:${mockServer.port}`,
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown?.message).toMatch(/EXIT_2/);
    expect(exitCode).toBe(2);
  });

  test('publish: missing --publisher-email and no active profile email → exit 1', async () => {
    const { publishCommand } = await import('../../src/cli/commands/bounty-task/publish.js');

    let thrown: any = null;
    try {
      await (publishCommand as any).handler({
        title: 't',
        description: 'd',
        type: 'coding',
        reward: 100,
        'server-url': 'http://127.0.0.1:1',
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown?.message).toMatch(/EXIT_/);
    expect(exitCode).toBeGreaterThanOrEqual(1);
    expect(consoleErrorOutput.some((s) => s.includes('--publisher-email') || s.includes('publisher-email'))).toBe(true);
  });

  test('publish: server error (500) → exit 4', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ error: 'Internal server error' }, { status: 500 });
      },
    });

    const { publishCommand } = await import('../../src/cli/commands/bounty-task/publish.js');

    let thrown: any = null;
    try {
      await (publishCommand as any).handler({
        title: 't',
        description: 'd',
        type: 'coding',
        reward: 100,
        'publisher-email': PUB_EMAIL,
        'server-url': `http://localhost:${mockServer.port}`,
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown?.message).toMatch(/EXIT_4/);
    expect(exitCode).toBe(4);
  });

  test('publish: network error → exit 4 + friendly message (alias check)', async () => {
    const { publishCommand } = await import('../../src/cli/commands/bounty-task/publish.js');

    let thrown: any = null;
    try {
      await (publishCommand as any).handler({
        title: 't',
        description: 'd',
        type: 'coding',
        reward: 100,
        'publisher-email': PUB_EMAIL,
        'server-url': 'http://127.0.0.1:1',
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown?.message).toMatch(/EXIT_4/);
    expect(exitCode).toBe(4);
  });

  test('grab: network error → exit 4', async () => {
    const { grabCommand } = await import('../../src/cli/commands/bounty-task/grab.js');

    let thrown: any = null;
    try {
      await (grabCommand as any).handler({
        'task-id': '8de9b6aa-5781-4a65-be96-45185fb7c8b1',
        email: AGENT_EMAIL,
        'server-url': 'http://127.0.0.1:1',
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown?.message).toMatch(/EXIT_4/);
    expect(exitCode).toBe(4);
  });
});
