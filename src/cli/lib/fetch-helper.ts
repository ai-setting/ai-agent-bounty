/**
 * Shared fetch helper for bounty CLI.
 *
 * 目的：v0.5.0 起，bounty CLI 默认跳过 TLS 证书验证，方便 agent 调用时
 * 无需手动加 -k / --insecure flag（自签名证书 / k8s ingress 场景）。
 *
 * 设计要点：
 * - `bountyFetch(url, options)` — 包装原生 fetch，自动设置 TLS skip 默认值
 * - `--tls-verify` CLI flag（v0.5.0 新增）：让用户重新开启 TLS 验证
 * - `--insecure / -k` 旧 flag（v0.4.x 兼容）：保留，向后兼容
 * - 通过设置 `NODE_TLS_REJECT_UNAUTHORIZED=0` 全局跳过 TLS 验证
 *   （Node 原生 fetch 读这个 env，单一全局开关最稳定）
 *
 * 用法：
 *   import { bountyFetch, setTlsVerifyMode } from '../lib/fetch-helper.js';
 *   setTlsVerifyMode('on');                  // 显式开启验证
 *   const response = await bountyFetch(url, { method: 'POST', headers, body });
 *
 * 优先级（决定是否跳过 TLS）：
 * 1. `setTlsVerifyMode('on')` 显式开启验证
 * 2. `setTlsVerifyMode('off')` 显式跳过（默认）
 * 3. 命令的 --insecure flag → 等价 setTlsVerifyMode('off')
 * 4. 命令的 --tls-verify flag → 等价 setTlsVerifyMode('on')
 */

/**
 * Module-level flag tracking whether TLS verification should be enabled.
 *
 * - 'off' (default): skip TLS verification (set NODE_TLS_REJECT_UNAUTHORIZED=0)
 * - 'on': keep TLS verification enabled (delete env var)
 */
let tlsMode: 'off' | 'on' = 'off';

/**
 * Returns the current TLS verify mode.
 */
export function getTlsMode(): 'off' | 'on' {
  return tlsMode;
}

/**
 * Read-only check: is TLS verification currently disabled?
 * Convenience for tests and debugging.
 */
export function isTlsVerifyDisabled(): boolean {
  return process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0';
}

/**
 * Switch TLS verification mode. Applied to NODE_TLS_REJECT_UNAUTHORIZED immediately.
 *
 * @param mode 'off' = skip verification (default); 'on' = enforce verification
 */
export function setTlsVerifyMode(mode: 'off' | 'on'): void {
  tlsMode = mode;
  if (mode === 'off') {
    // Default-on behavior for self-signed cert scenarios:
    // set NODE_TLS_REJECT_UNAUTHORIZED = '0' so all subsequent fetch() calls skip verification.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  } else {
    // 'on': remove the override so Node uses its default (verify).
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  }
}

/**
 * Re-export of native fetch, for explicit "I want a raw fetch" cases.
 * Most bounty CLI commands should use `bountyFetch` instead.
 */
export const rawFetch = fetch;

/**
 * Default-on TLS skip behavior. When the module is imported, set the
 * global env so all subsequent `fetch()` calls skip verification.
 *
 * NOTE: This is a side-effect at import time. Importing this module
 * implicitly enables TLS skip. Use `setTlsVerifyMode('on')` to opt back in.
 */
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

/**
 * Wrapper around native fetch that preserves the default-on TLS skip behavior.
 *
 * @param url   Target URL
 * @param init  Standard fetch init options
 * @returns     Standard fetch Response
 */
export async function bountyFetch(
  url: string | URL,
  init?: RequestInit
): Promise<Response> {
  // Re-assert TLS skip at call time, in case the env var was reset by
  // a parent process or by `delete process.env.NODE_TLS_REJECT_UNAUTHORIZED`.
  if (tlsMode === 'off' && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }
  return fetch(url, init);
}