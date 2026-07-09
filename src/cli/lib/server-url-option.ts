/**
 * Shared CLI helper for the `--server-url` option.
 *
 * 目的：消除 12+ 个 CLI 命令里重复的 --server-url 定义 + scheme 校验 +
 * 末尾 / trim 逻辑。所有命令（auth/*, register-agent/*, com/*）统一使用：
 *
 *   import { addServerUrlOption, resolveServerUrl } from '../lib/server-url-option.js';
 *   builder: (y) => addServerUrlOption(y.option(...))
 *   handler: const baseUrl = resolveServerUrl(opts.serverUrl, API_BASE);
 *
 * 行为约定：
 * - `addServerUrlOption(yargs)` — 给 yargs 加 --server-url / -u 选项
 * - `resolveServerUrl(serverUrl, fallback)` —
 *   1. serverUrl 为空 → 返回 fallback（默认 API_BASE）
 *   2. 否则 trim 末尾 / 后返回
 *   3. 若 trim 后不以 http:// 或 https:// 开头 → console.error + process.exit(1)
 *
 * 设计要点：
 * - alias 用 `u` 而非 `e`（`e` 在 auth/* / register-agent/* 中被 --email 占用，
 *   yargs 重复 alias 会把两个 option 的值都收集成数组）。
 *   com/send.ts 的 `-e` 是因为它没有 email 选项，可以独占。
 * - 优先级：`--server-url` > `BOUNTY_API_URL` env (经由 API_BASE) > 默认 `http://localhost:4000`
 *
 * Phase: feat/bounty-all-commands-server-url
 */

import type { Argv } from 'yargs';
import chalk from 'chalk';

/**
 * 给 yargs 实例添加 `--server-url / -u` 选项。
 *
 * 典型用法：
 *   builder: (y) =>
 *     addServerUrlOption(
 *       y.option('email', { alias: 'e', type: 'string', demandOption: true })
 *     )
 *
 * 注意：TypeScript 这里不强约束泛型，由调用者负责把它与自己的 options 类型合并。
 */
export function addServerUrlOption<T extends object>(yargs: Argv<T>): Argv<T> {
  return yargs.option('server-url', {
    alias: 'u',
    type: 'string',
    description:
      'Service base URL (e.g., http://localhost:4000 or https://bounty.example.com). ' +
      'When set, overrides BOUNTY_API_URL env var and default. ' +
      'Must start with http:// or https://. Trailing slashes are auto-trimmed.',
  });
}

/**
 * 解析 --server-url 值，返回可用于 fetch 的 base URL。
 *
 * @param serverUrl CLI 传入的 --server-url 值（可能 undefined、空串、合法 URL、非 scheme 字符串）
 * @param fallback  默认值（通常传 API_BASE，即 BOUNTY_API_URL env > http://localhost:4000）
 * @returns         可直接拼接 `${baseUrl}/api/...` 的 base URL（无尾 /）
 *
 * 副作用：当 serverUrl 存在但无效（非 http/https 开头）时，console.error + process.exit(1)。
 * 返回值保证：要么是符合 scheme 的 trimmed base URL，要么是 fallback。
 */
export function resolveServerUrl(
  serverUrl: string | undefined,
  fallback: string
): string {
  if (!serverUrl) return fallback;
  const trimmed = serverUrl.replace(/\/+$/, '');
  if (!/^https?:\/\//.test(trimmed)) {
    console.error(
      chalk.red(
        `\n✗ Invalid --server-url: "${serverUrl}". Must start with http:// or https://\n`
      )
    );
    process.exit(1);
  }
  return trimmed;
}
