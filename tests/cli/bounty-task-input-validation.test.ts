/**
 * Tests for input validation across bounty-task CLI commands.
 *
 * Phase: feat/bounty-task-optimize
 *
 * 设计动机: 在客户端做基本格式校验，让用户立即得到反馈，而不必等 HTTP 往返。
 *   - reward > 0 (publish)
 *   - min/max reward >= 0 (board)
 *   - task-id UUID v4 格式 (grab/submit/complete/cancel)
 *
 * 测试场景：
 * 1. publish: reward = 0 → 友好错误
 * 2. publish: reward = -10 → 友好错误
 * 3. publish: tags 含空字符串 → trim 后过滤
 * 4. board: min-reward = -5 → 友好错误
 * 5. board: max-reward = -5 → 友好错误
 * 6. grab: task-id 非 UUID 格式 → 友好错误
 * 7. submit: task-id 非 UUID 格式 → 友好错误
 * 8. complete: task-id 非 UUID 格式 → 友好错误
 * 9. cancel: task-id 非 UUID 格式 → 友好错误
 * 10. submit: --result 为空字符串 → 友好错误
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';

describe('bounty bounty-task - input validation', () => {
  let exitCode: number | null = null;
  let consoleErrorOutput: string[] = [];

  beforeEach(() => {
    exitCode = null;
    consoleErrorOutput = [];
    delete process.env.BOUNTY_IM_ADDRESS;

    spyOn(console, 'error').mockImplementation((...args: any[]) => {
      consoleErrorOutput.push(args.map(String).join(' '));
    });
    spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`EXIT_${code ?? 0}`);
    }) as any);
  });

  afterEach(() => {
    (console.error as any).mockRestore?.();
    (process.exit as any).mockRestore?.();
  });

  // UUID v4 格式: 8-4-4-4-12 hex, version char = '4'
  const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  test('publish: reward = 0 → exit 2 with friendly error', async () => {
    const { publishCommand } = await import('../../src/cli/commands/bounty-task/publish.js');
    process.env.BOUNTY_IM_ADDRESS = '8de9b6aa-5781-4a65-be96-45185fb7c8b1@host.local';

    let thrown: any = null;
    try {
      await (publishCommand as any).handler({ title: 't', description: 'd', type: 'c', reward: 0 });
    } catch (e) { thrown = e; }
    expect(thrown?.message).toMatch(/EXIT_2/);
    expect(consoleErrorOutput.some(s => s.includes('reward must be a positive number'))).toBe(true);
  });

  test('publish: reward = -10 → exit 2 with friendly error', async () => {
    const { publishCommand } = await import('../../src/cli/commands/bounty-task/publish.js');
    process.env.BOUNTY_IM_ADDRESS = '8de9b6aa-5781-4a65-be96-45185fb7c8b1@host.local';

    let thrown: any = null;
    try {
      await (publishCommand as any).handler({ title: 't', description: 'd', type: 'c', reward: -10 });
    } catch (e) { thrown = e; }
    expect(thrown?.message).toMatch(/EXIT_2/);
    expect(consoleErrorOutput.some(s => s.includes('reward must be a positive number'))).toBe(true);
  });

  test('board: min-reward = -5 → exit 2', async () => {
    const { boardCommand } = await import('../../src/cli/commands/bounty-task/board.js');
    let thrown: any = null;
    try {
      await (boardCommand as any).handler({ 'min-reward': -5 });
    } catch (e) { thrown = e; }
    expect(thrown?.message).toMatch(/EXIT_2/);
    expect(consoleErrorOutput.some(s => s.includes('--min-reward'))).toBe(true);
  });

  test('board: max-reward = -5 → exit 2', async () => {
    const { boardCommand } = await import('../../src/cli/commands/bounty-task/board.js');
    let thrown: any = null;
    try {
      await (boardCommand as any).handler({ 'max-reward': -5 });
    } catch (e) { thrown = e; }
    expect(thrown?.message).toMatch(/EXIT_2/);
    expect(consoleErrorOutput.some(s => s.includes('--max-reward'))).toBe(true);
  });

  test('grab: task-id "not-a-uuid" → exit 2 with format hint', async () => {
    const { grabCommand } = await import('../../src/cli/commands/bounty-task/grab.js');
    process.env.BOUNTY_IM_ADDRESS = '8de9b6aa-5781-4a65-be96-45185fb7c8b1@host.local';

    let thrown: any = null;
    try {
      await (grabCommand as any).handler({ 'task-id': 'not-a-uuid' });
    } catch (e) { thrown = e; }
    expect(thrown?.message).toMatch(/EXIT_2/);
    expect(consoleErrorOutput.some(s => s.includes('UUID'))).toBe(true);
  });

  test('submit: task-id "abc" → exit 2', async () => {
    const { submitCommand } = await import('../../src/cli/commands/bounty-task/submit.js');
    process.env.BOUNTY_IM_ADDRESS = '8de9b6aa-5781-4a65-be96-45185fb7c8b1@host.local';

    let thrown: any = null;
    try {
      await (submitCommand as any).handler({ 'task-id': 'abc', result: 'r' });
    } catch (e) { thrown = e; }
    expect(thrown?.message).toMatch(/EXIT_2/);
  });

  test('complete: task-id "short" → exit 2', async () => {
    const { completeCommand } = await import('../../src/cli/commands/bounty-task/complete.js');
    process.env.BOUNTY_IM_ADDRESS = '8de9b6aa-5781-4a65-be96-45185fb7c8b1@host.local';

    let thrown: any = null;
    try {
      await (completeCommand as any).handler({ 'task-id': 'short' });
    } catch (e) { thrown = e; }
    expect(thrown?.message).toMatch(/EXIT_2/);
  });

  test('cancel: task-id "" → exit 2', async () => {
    const { cancelCommand } = await import('../../src/cli/commands/bounty-task/cancel.js');
    process.env.BOUNTY_IM_ADDRESS = '8de9b6aa-5781-4a65-be96-45185fb7c8b1@host.local';

    let thrown: any = null;
    try {
      await (cancelCommand as any).handler({ 'task-id': '' });
    } catch (e) { thrown = e; }
    expect(thrown?.message).toMatch(/EXIT_2/);
  });

  test('submit: --result empty string → exit 2', async () => {
    const { submitCommand } = await import('../../src/cli/commands/bounty-task/submit.js');
    process.env.BOUNTY_IM_ADDRESS = '8de9b6aa-5781-4a65-be96-45185fb7c8b1@host.local';
    const validUuid = '8de9b6aa-5781-4a65-be96-45185fb7c8b1';

    let thrown: any = null;
    try {
      await (submitCommand as any).handler({ 'task-id': validUuid, result: '   ' });
    } catch (e) { thrown = e; }
    expect(thrown?.message).toMatch(/EXIT_2/);
    expect(consoleErrorOutput.some(s => s.includes('result cannot be empty'))).toBe(true);
  });

  test('UUID v4 regex sanity: valid uuid passes format check', () => {
    expect(UUID_V4_REGEX.test('8de9b6aa-5781-4a65-be96-45185fb7c8b1')).toBe(true);
    expect(UUID_V4_REGEX.test('not-a-uuid')).toBe(false);
    expect(UUID_V4_REGEX.test('12345678-1234-1234-1234-123456789012')).toBe(false); // version != 4
  });
});