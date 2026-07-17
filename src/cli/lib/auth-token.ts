/**
 * Shared helper for reading the saved bounty auth token.
 *
 * Phase: feat/bounty-task-optimize (auth-token extraction)
 * Phase: feat/profile-mechanism-pr1 (ProfileContext priority + BOUNTY_TOKEN env removal)
 *
 * 设计动机: `readAuthToken()` 原本内嵌在 `com/send.ts`，只能被 com/* 命令使用。
 * 现在抽出到 `src/cli/lib/auth-token.ts`，让 bounty-task/* 也能复用，保持
 * 所有 CLI 命令的鉴权体验一致。
 *
 * 行为约定（PR1 后）：
 * 1. **优先**从 `ProfileContext.getAccessToken()` 读取 —— 这是 PR1 新增的 profile 文件机制。
 *    所有经过 `--profile` / `BOUNTY_PROFILE` / `active_profile` 解析的命令都会在
 *    yargs middleware 中设置 ProfileContext，所以这条路径是首选。
 * 2. **回退**到磁盘 token 文件（`~/.config/bounty/token`，由 `bounty auth login` 写入）。
 *    文件缺失 / 不可读 / 内容为空 → 返回 undefined（不抛错）。
 *    内容自动 trim 首尾空白。
 * 3. **不再读取 `process.env.BOUNTY_TOKEN`**（用户明确要求 PR1 移除）。
 *    这是 design doc 的核心变更：env 不再是主配置入口。
 * 4. **保留显式 `tokenPath` 参数**用于向后兼容（bounty-http / soft-auth / 单元测试）。
 *    这些调用点传自己的 tokenPath，不依赖 ProfileContext。
 *
 * 测试支持：
 * - 接受可选的 `tokenPath` 参数（DI），便于单元测试用 temp 文件隔离
 *
 * 用法：
 *   import { readAuthToken } from '../lib/auth-token.js';
 *   const token = readAuthToken();
 *   if (token) headers['Authorization'] = `Bearer ${token}`;
 */

import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { ProfileContext } from '../config/context.js';

/** Default location for saved auth token (written by `bounty auth login`). */
export const DEFAULT_TOKEN_PATH = join(homedir(), '.config', 'bounty', 'token');

/**
 * Read the auth token, preferring ProfileContext over the legacy token file.
 *
 * Resolution order (PR1):
 *   1. `ProfileContext.getAccessToken()` if a profile is active AND has a token
 *   2. On-disk token file at `tokenPath` (defaults to `~/.config/bounty/token`)
 *
 * Returns undefined if neither source yields a non-empty token. Never throws.
 *
 * @param tokenPath  Optional override for the token file path. Defaults to
 *                   `~/.config/bounty/token`. Pass an explicit path in tests
 *                   to avoid touching the user's real `~/.config/bounty/`.
 */
export function readAuthToken(tokenPath: string = DEFAULT_TOKEN_PATH): string | undefined {
  // 1. ProfileContext first (PR1) — populated by profileMiddleware before
  //    every command runs. When a profile has an access_token, that wins
  //    over any on-disk token file left over from a previous login flow.
  const ctxToken = ProfileContext.getAccessToken();
  if (ctxToken) return ctxToken;

  // 2. Legacy on-disk token file. Kept for back-compat with bounty-http,
  //    soft-auth, and callers that pass their own tokenPath.
  try {
    if (!existsSync(tokenPath)) return undefined;
    const content = readFileSync(tokenPath, 'utf-8').trim();
    return content || undefined;
  } catch {
    return undefined;
  }
}