/**
 * `withAuthRetry()` — transparent 401 token refresh middleware.
 *
 * Phase: feat/bounty-task-optimize (Tier D.2)
 *
 * 设计动机：bounty-task/* 命令偶尔会收到 HTTP 401（token 过期或被刷新）。
 * 此时不应该直接 fail 提示用户重新登录，而是先尝试调用外部 `bounty auth
 * refresh` 命令（或调用方提供的 onRefresh 回调）刷新 token，然后再试一次。
 * 这样 token 轮换对调用方完全透明，CLI 体验更顺滑。
 *
 * 行为约定：
 * - 第一次调用成功 → 直接返回结果（不触发 refresh）
 * - 第一次抛 BountyHttpError 且 status === 401 → 调用 onRefresh → 再试一次
 *   - 第二次成功 → 返回结果
 *   - 第二次仍 401 → 抛第二次的错误
 *   - refresh 回调本身抛错 → 抛 refresh 的错误（不再 fn 重试，避免无效循环）
 * - 第一次抛 BountyHttpError 且 status !== 401（403 / 4xx / 5xx）→ 直接 throw
 * - 第一次抛非 BountyHttpError（普通 Error）→ 直接 throw
 *
 * 设计选择（避免陷阱）：
 * - **不自动 spawn 子进程**：refresh 的实际命令是 `bounty auth refresh`，
 *   但自动 spawn 在 CLI 测试中容易 hang / 留下孤儿进程。要求调用方注入
 *   onRefresh 函数（生产代码用 `spawnBountyAuthRefresh()`，测试用 mock）。
 * - **最多 1 次 refresh**：避免 401/refresh 死循环（refresh 后仍 401 直接 throw）
 *
 * 用法：
 *   import { withAuthRetry } from '../lib/with-auth-retry.js';
 *   const task = await withAuthRetry(
 *     () => bountyHttp({ ... }),
 *     { onRefresh: spawnBountyAuthRefresh }
 *   );
 */

import { BountyHttpError } from './bounty-http.js';

export interface WithAuthRetryOptions {
  /**
   * Function called when a 401 is detected. Should refresh the auth token
   * (e.g., by running `bounty auth refresh` and waiting for it to complete).
   *
   * If omitted, the function will throw the original 401 error without
   * attempting refresh. (Useful for tests that don't want subprocess spawning.)
   */
  onRefresh?: () => Promise<void>;
}

/**
 * Execute `fn` with transparent 401 retry.
 *
 * - If `fn()` succeeds: returns its result.
 * - If `fn()` throws BountyHttpError with status === 401:
 *     - calls `onRefresh()` (if provided)
 *     - retries `fn()` once
 *     - returns retry result, or throws retry error / refresh error
 * - Other errors: thrown as-is.
 */
export async function withAuthRetry<T>(
  fn: () => Promise<T>,
  options: WithAuthRetryOptions = {}
): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    // Only BountyHttpError with status === 401 triggers refresh
    const is401 = err instanceof BountyHttpError && err.status === 401;
    if (!is401) {
      throw err;
    }

    // No onRefresh provided → can't recover, throw original 401
    if (!options.onRefresh) {
      throw err;
    }

    // Try to refresh — if this itself fails, throw refresh error
    // (no point retrying if token refresh is broken)
    await options.onRefresh();

    // Retry once. If this still 401s, throw the second error.
    return await fn();
  }
}