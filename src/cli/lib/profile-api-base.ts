/**
 * Profile-aware API base resolver.
 *
 * PR3 helper: 让 auth/* 命令统一用 "active profile → --server-url → fallback" 的顺序
 * 决定 fetch base URL，避免每个命令重复实现。
 *
 * 优先级：
 * 1. `cliServerUrl`（--server-url 显式传入）→ 用 resolveServerUrlFn 校验；
 * 2. 否则如果 profile 存在 → profile.api_base（已通过 schema 校验）；
 * 3. 否则 fallbackApiBase（API_BASE，默认 http://localhost:4000 或 BOUNTY_API_URL env）。
 *
 * 设计为纯函数 + DI（resolveServerUrlFn 注入），便于单测覆盖各种组合。
 */

export interface ResolveProfileApiBaseInput {
  cliServerUrl?: string;
  fallbackApiBase: string;
  profile: { api_base: string; name?: string } | null;
  resolveServerUrlFn: (serverUrl: string | undefined, fallback: string) => string;
}

export function resolveProfileApiBase({
  cliServerUrl,
  fallbackApiBase,
  profile,
  resolveServerUrlFn,
}: ResolveProfileApiBaseInput): string {
  if (cliServerUrl && cliServerUrl.trim().length > 0) {
    return resolveServerUrlFn(cliServerUrl, fallbackApiBase);
  }
  if (profile?.api_base) {
    return profile.api_base.replace(/\/+$/, '');
  }
  return resolveServerUrlFn(undefined, fallbackApiBase);
}