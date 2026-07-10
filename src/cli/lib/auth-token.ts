/**
 * Shared helper for reading the saved bounty auth token.
 *
 * Phase: feat/bounty-task-optimize
 *
 * 设计动机: `readAuthToken()` 原本内嵌在 `com/send.ts`，只能被 com/* 命令使用。
 * 现在抽出到 `src/cli/lib/auth-token.ts`，让 bounty-task/* 也能复用，保持
 * 所有 CLI 命令的鉴权体验一致。
 *
 * 行为约定：
 * - token 文件默认在 `~/.config/bounty/token`（由 `bounty auth login` 写入）
 * - 文件缺失 / 不可读 / 内容为空 → 返回 undefined（不抛错）
 * - 内容自动 trim 首尾空白
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

/** Default location for saved auth token (written by `bounty auth login`). */
export const DEFAULT_TOKEN_PATH = join(homedir(), '.config', 'bounty', 'token');

/**
 * Read the saved auth token from disk.
 *
 * Returns the trimmed token string if the file exists and has content.
 * Returns undefined if the file is missing, empty, or unreadable.
 *
 * @param tokenPath  Optional override for the token file path. Defaults to
 *                   `~/.config/bounty/token`. Pass an explicit path in tests
 *                   to avoid touching the user's real `~/.config/bounty/`.
 */
export function readAuthToken(tokenPath: string = DEFAULT_TOKEN_PATH): string | undefined {
  try {
    if (!existsSync(tokenPath)) return undefined;
    const content = readFileSync(tokenPath, 'utf-8').trim();
    return content || undefined;
  } catch {
    return undefined;
  }
}