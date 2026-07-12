/**
 * Tests for error classification across bounty-task CLI commands.
 *
 * Phase: feat/bounty-task-optimize
 *
 * 设计动机: 现有 bounty-task 命令失败时只打 `error.message`，对用户不友好。
 * 重构后用 `handleBountyError()` 根据 BountyHttpError.type 给出分类提示：
 *   - network → 提示启动 server, exit 4
 *   - auth → 提示登录, exit 3
 *   - business → 显示 server error, exit 2
 *   - server → 提示 server 端问题, exit 4
 *
 * 测试场景（用 mock server 触发真实错误，再用 process.exit spy 捕获 exit code）：
 * 1. publish: 网络错误 → exit 4
 * 2. publish: auth 错误 → exit 3
 * 3. publish: business 错误 → exit 2
 * 4. publish: server 错误 → exit 4
 * 5. grab: 网络错误 → exit 4
 * 6. submit: 鉴权错误 → exit 3
 * 7. complete: 业务错误 → exit 2
 * 8. cancel: server 错误 → exit 4
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';

describe('bounty bounty-task - error classification (exit code mapping)', () => {
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
    process.env.BOUNTY_IM_ADDRESS = '8de9b6aa-5781-4a65-be96-45185fb7c8b1@host.local';

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

    expect(thrown?.message).toMatch(/EXIT_4/);
    expect(exitCode).toBe(4);
    expect(consoleErrorOutput.some(s => s.includes('Network error'))).toBe(true);
    expect(consoleErrorOutput.some(s => s.includes('bounty server'))).toBe(true);
  });

  test('publish: auth error (401) → exit 3', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      },
    });
    process.env.BOUNTY_IM_ADDRESS = '8de9b6aa-5781-4a65-be96-45185fb7c8b1@host.local';

    const { publishCommand } = await import('../../src/cli/commands/bounty-task/publish.js');

    let thrown: any = null;
    try {
      await (publishCommand as any).handler({
        title: 't',
        description: 'd',
        type: 'coding',
        reward: 100,
        'server-url': `http://localhost:${mockServer.port}`,
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown?.message).toMatch(/EXIT_3/);
    expect(exitCode).toBe(3);
    expect(consoleErrorOutput.some(s => s.includes('Authentication'))).toBe(true);
  });

  test('publish: business error (400 reward=0) → exit 2', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ error: 'reward must be > 0' }, { status: 400 });
      },
    });
    process.env.BOUNTY_IM_ADDRESS = '8de9b6aa-5781-4a65-be96-45185fb7c8b1@host.local';

    const { publishCommand } = await import('../../src/cli/commands/bounty-task/publish.js');

    let thrown: any = null;
    try {
      await (publishCommand as any).handler({
        title: 't',
        description: 'd',
        type: 'coding',
        reward: 100,  // valid client-side; server returns 400
        'server-url': `http://localhost:${mockServer.port}`,
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown?.message).toMatch(/EXIT_2/);
    expect(exitCode).toBe(2);
    expect(consoleErrorOutput.some(s => s.includes('reward must be > 0'))).toBe(true);
  });

  test('publish: server error (500) → exit 4', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ error: 'Database locked' }, { status: 500 });
      },
    });
    process.env.BOUNTY_IM_ADDRESS = '8de9b6aa-5781-4a65-be96-45185fb7c8b1@host.local';

    const { publishCommand } = await import('../../src/cli/commands/bounty-task/publish.js');

    let thrown: any = null;
    try {
      await (publishCommand as any).handler({
        title: 't',
        description: 'd',
        type: 'coding',
        reward: 100,
        'server-url': `http://localhost:${mockServer.port}`,
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown?.message).toMatch(/EXIT_4/);
    expect(exitCode).toBe(4);
    expect(consoleErrorOutput.some(s => s.includes('server error') || s.includes('Server error') || s.includes('500'))).toBe(true);
  });

  test('grab: network error → exit 4', async () => {
    const { grabCommand } = await import('../../src/cli/commands/bounty-task/grab.js');
    process.env.BOUNTY_IM_ADDRESS = '8de9b6aa-5781-4a65-be96-45185fb7c8b1@host.local';

    let thrown: any = null;
    try {
      await (grabCommand as any).handler({
        'task-id': '8de9b6aa-5781-4a65-be96-45185fb7c8b1',
        'server-url': 'http://127.0.0.1:1',
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown?.message).toMatch(/EXIT_4/);
    expect(exitCode).toBe(4);
  });

  test('publish: missing --publisher-address and no BOUNTY_IM_ADDRESS → exit 2', async () => {
    const { publishCommand } = await import('../../src/cli/commands/bounty-task/publish.js');

    let thrown: any = null;
    try {
      await (publishCommand as any).handler({
        title: 't',
        description: 'd',
        type: 'coding',
        reward: 100,
        // 没有 --publisher-address, 也没有 BOUNTY_IM_ADDRESS
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown?.message).toMatch(/EXIT_2/);
    expect(exitCode).toBe(2);
    expect(consoleErrorOutput.some(s => s.includes('Cannot infer publisher address'))).toBe(true);
  });

  test('publish: reward <= 0 → exit 2 (client-side validation)', async () => {
    const { publishCommand } = await import('../../src/cli/commands/bounty-task/publish.js');
    process.env.BOUNTY_IM_ADDRESS = '8de9b6aa-5781-4a65-be96-45185fb7c8b1@host.local';

    let thrown: any = null;
    try {
      await (publishCommand as any).handler({
        title: 't',
        description: 'd',
        type: 'coding',
        reward: 0,
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown?.message).toMatch(/EXIT_2/);
    expect(exitCode).toBe(2);
    expect(consoleErrorOutput.some(s => s.includes('reward must be a positive number'))).toBe(true);
  });

  test('board: min-reward < 0 → exit 2 (client-side validation)', async () => {
    const { boardCommand } = await import('../../src/cli/commands/bounty-task/board.js');

    let thrown: any = null;
    try {
      await (boardCommand as any).handler({
        'min-reward': -1,
      });
    } catch (e) {
      thrown = e;
    }

    expect(thrown?.message).toMatch(/EXIT_2/);
    expect(exitCode).toBe(2);
    expect(consoleErrorOutput.some(s => s.includes('--min-reward must be >= 0'))).toBe(true);
  });
});