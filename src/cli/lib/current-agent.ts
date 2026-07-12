/**
 * Default agent inference helper for bounty CLI commands.
 *
 * Phase: feat/bounty-task-optimize
 *
 * 设计动机: bounty-task/* 命令当前要求用户必须显式传 `--publisher-id` 或
 * `--agent-id`，对体验很差。改进后这些参数可以省略，从以下来源自动推断：
 *
 *   1. `BOUNTY_IM_ADDRESS` (形如 `agent-uuid@host`) → 提取 agent-uuid 部分
 *   2. `~/.config/bounty/token` (JWT) → 解码 payload.sub (后续 phase)
 *
 * 优先级: BOUNTY_IM_ADDRESS > token file > undefined
 *
 * 用法：
 *   import { resolveCurrentAgent } from '../lib/current-agent.js';
 *   const agentId = resolveCurrentAgent();
 *   if (!agentId) {
 *     console.error('Cannot infer current agent. Set BOUNTY_IM_ADDRESS or pass --publisher-id.');
 *     process.exit(2);
 *   }
 *
 * 测试支持：
 * - 接受可选的 `tokenPath` 参数（DI），便于单元测试用 temp 文件隔离
 */

import { readAuthToken } from './auth-token.js';
import { parseAgentAddress } from './address-parser.js';

export interface ResolveCurrentAgentOptions {
  /**
   * Explicit override for the token file path. Defaults to
   * `~/.config/bounty/token`. Useful for tests.
   */
  tokenPath?: string;
}

/**
 * Resolve the current agent ID from environment / token file.
 *
 * Returns the agent UUID string if it can be inferred, otherwise undefined.
 * v0.10: `BOUNTY_IM_ADDRESS` MUST be `<uuid>@<host>`; bare UUID is rejected.
 *
 * @param options.tokenPath  Override the token file path (default: ~/.config/bounty/token)
 * @returns                  agent UUID string or undefined
 */
export function resolveCurrentAgent(
  options: ResolveCurrentAgentOptions = {}
): string | undefined {
  // 优先级 1: BOUNTY_IM_ADDRESS env (e.g., "8de9b6aa-...@bounty.example.com")
  // v0.10 BREAKING: bare UUIDs are rejected (was: lenient fallback in v0.7-v0.9)
  const imAddress = process.env.BOUNTY_IM_ADDRESS;
  if (imAddress && imAddress.trim()) {
    const parsed = parseAgentAddress(imAddress, 'BOUNTY_IM_ADDRESS');
    if (parsed.ok) return parsed.value.uuid;
    // bare UUID or invalid format → not returned to caller (was: returned in v0.7)
  }

  // 优先级 2: ~/.config/bounty/token (JWT)
  // TODO (后续 phase): 解码 JWT payload 提取 sub claim
  // 现在先 placeholder — 有 token 文件存在表示有鉴权能力，但不提取 agent id
  const token = readAuthToken(options.tokenPath);
  if (token) {
    // 未来可以加: const claims = decodeJwt(token); return claims?.sub;
    // 当前先返回 undefined, 让 caller 走显式参数 fallback
  }

  return undefined;
}

/**
 * Resolve the current agent's FULL address (`<uuid>@<host>`) for v0.10 callers
 * that need to send the address triple to the server (not just the uuid).
 *
 * v0.10: bare UUID BOUNTY_IM_ADDRESS returns undefined (rejected, not lenient).
 *
 * @param options.tokenPath  Override the token file path (default: ~/.config/bounty/token)
 * @returns                  full `Address` triple, or undefined
 */
export function resolveCurrentAgentAddress(
  options: ResolveCurrentAgentOptions = {}
): { uuid: string; host: string; raw: string } | undefined {
  const imAddress = process.env.BOUNTY_IM_ADDRESS;
  if (imAddress && imAddress.trim()) {
    const parsed = parseAgentAddress(imAddress, 'BOUNTY_IM_ADDRESS');
    if (parsed.ok) return parsed.value;
  }
  return undefined;
}