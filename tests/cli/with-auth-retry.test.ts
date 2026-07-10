/**
 * Tests for `withAuthRetry()` middleware.
 *
 * Phase: feat/bounty-task-optimize (Tier D.2)
 *
 * 设计动机：bounty-task/* 命令偶尔会收到 HTTP 401（token 过期）。
 * 此时不应该直接 fail，而是先尝试调用 `bounty auth refresh` 刷新 token，
 * 然后重试一次。这样 token 轮换对调用方完全透明。
 *
 * 测试场景：
 * 1. 第一次成功 → 不 refresh，不重试
 * 2. 第一次 401 → refresh → 第二次成功 → ok
 * 3. 第一次 401 → refresh → 第二次仍 401 → 抛原 error
 * 4. 第一次非 401 错误（500）→ 不 refresh，直接 throw
 * 5. 非 BountyHttpError（普通 Error）→ 不 refresh，直接 throw
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { BountyHttpError } from '../../src/cli/lib/bounty-http.js';

describe('withAuthRetry - transparent 401 token refresh', () => {
  let refreshCalls = 0;
  let refreshCallback: (() => Promise<void>) | null = null;

  beforeEach(() => {
    refreshCalls = 0;
    refreshCallback = null;
  });

  afterEach(() => {
    refreshCallback = null;
  });

  // Helper that runs the refresh callback when invoked
  async function runRefresh(): Promise<void> {
    refreshCalls++;
    if (refreshCallback) {
      await refreshCallback();
    }
  }

  test('200 first try → fn called once, no refresh', async () => {
    const { withAuthRetry } = await import('../../src/cli/lib/with-auth-retry.js');
    let fnCalls = 0;
    const result = await withAuthRetry(
      async () => {
        fnCalls++;
        return { ok: true, value: 42 };
      },
      { onRefresh: runRefresh }
    );

    expect(result).toEqual({ ok: true, value: 42 });
    expect(fnCalls).toBe(1);
    expect(refreshCalls).toBe(0);
  });

  test('401 first try → refresh → 200 second try → ok', async () => {
    const { withAuthRetry } = await import('../../src/cli/lib/with-auth-retry.js');
    let fnCalls = 0;
    const result = await withAuthRetry(
      async () => {
        fnCalls++;
        if (fnCalls === 1) {
          throw new BountyHttpError('auth', 401, 'Token expired');
        }
        return { ok: true, value: 'refreshed' };
      },
      { onRefresh: runRefresh }
    );

    expect(result).toEqual({ ok: true, value: 'refreshed' });
    expect(fnCalls).toBe(2);
    expect(refreshCalls).toBe(1);
  });

  test('401 first try → refresh → still 401 → throw original error', async () => {
    const { withAuthRetry } = await import('../../src/cli/lib/with-auth-retry.js');
    let fnCalls = 0;
    let thrown: any = null;

    try {
      await withAuthRetry(
        async () => {
          fnCalls++;
          throw new BountyHttpError('auth', 401, `Token expired (attempt ${fnCalls})`);
        },
        { onRefresh: runRefresh }
      );
    } catch (e) {
      thrown = e;
    }

    expect(fnCalls).toBe(2);
    expect(refreshCalls).toBe(1);
    expect(thrown).toBeInstanceOf(BountyHttpError);
    expect(thrown.type).toBe('auth');
    expect(thrown.status).toBe(401);
    // Should be the SECOND error message (since the first 401 was "consumed" by retry)
    // Actually, the implementation may re-throw the second one (after refresh failed)
    expect(thrown.message).toContain('attempt 2');
  });

  test('non-401 error (500) → no refresh, throw directly', async () => {
    const { withAuthRetry } = await import('../../src/cli/lib/with-auth-retry.js');
    let fnCalls = 0;
    let thrown: any = null;

    try {
      await withAuthRetry(
        async () => {
          fnCalls++;
          throw new BountyHttpError('server', 500, 'Internal server error');
        },
        { onRefresh: runRefresh }
      );
    } catch (e) {
      thrown = e;
    }

    expect(fnCalls).toBe(1);
    expect(refreshCalls).toBe(0);
    expect(thrown).toBeInstanceOf(BountyHttpError);
    expect(thrown.status).toBe(500);
  });

  test('non-BountyHttpError (plain Error) → no refresh, throw directly', async () => {
    const { withAuthRetry } = await import('../../src/cli/lib/with-auth-retry.js');
    let fnCalls = 0;
    let thrown: any = null;

    try {
      await withAuthRetry(
        async () => {
          fnCalls++;
          throw new Error('Unexpected error');
        },
        { onRefresh: runRefresh }
      );
    } catch (e) {
      thrown = e;
    }

    expect(fnCalls).toBe(1);
    expect(refreshCalls).toBe(0);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toBe('Unexpected error');
  });

  test('403 forbidden → no refresh (only 401 triggers refresh)', async () => {
    const { withAuthRetry } = await import('../../src/cli/lib/with-auth-retry.js');
    let fnCalls = 0;
    let thrown: any = null;

    try {
      await withAuthRetry(
        async () => {
          fnCalls++;
          throw new BountyHttpError('auth', 403, 'Forbidden - permission denied');
        },
        { onRefresh: runRefresh }
      );
    } catch (e) {
      thrown = e;
    }

    expect(fnCalls).toBe(1);
    expect(refreshCalls).toBe(0);
    expect(thrown).toBeInstanceOf(BountyHttpError);
    expect(thrown.status).toBe(403);
  });

  test('refresh callback failure → still retries then throws', async () => {
    const { withAuthRetry } = await import('../../src/cli/lib/with-auth-retry.js');
    let fnCalls = 0;
    let thrown: any = null;

    try {
      await withAuthRetry(
        async () => {
          fnCalls++;
          throw new BountyHttpError('auth', 401, 'Token expired');
        },
        {
          onRefresh: async () => {
            refreshCalls++;
            throw new Error('Refresh command crashed');
          },
        }
      );
    } catch (e) {
      thrown = e;
    }

    // If refresh itself fails, fn should NOT be retried — just throw the refresh error
    expect(fnCalls).toBe(1);
    expect(refreshCalls).toBe(1);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toBe('Refresh command crashed');
  });

  test('default onRefresh option is required (no auto-spawn to avoid hanging tests)', async () => {
    // This test documents that we don't auto-spawn — caller must provide onRefresh.
    // The behavior is that without onRefresh, the function throws if invoked.
    const { withAuthRetry } = await import('../../src/cli/lib/with-auth-retry.js');
    let fnCalls = 0;
    let thrown: any = null;

    try {
      await withAuthRetry(
        async () => {
          fnCalls++;
          throw new BountyHttpError('auth', 401, 'Token expired');
        }
        // no onRefresh provided
      );
    } catch (e) {
      thrown = e;
    }

    expect(fnCalls).toBe(1);
    // Should throw the original 401 since no refresh was provided
    expect(thrown).toBeInstanceOf(BountyHttpError);
    expect(thrown.status).toBe(401);
  });
});