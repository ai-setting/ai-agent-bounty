/**
 * Default agent inference helper for bounty CLI commands.
 *
 * v0.14 BREAKING (Q5 ✅ DELETE):
 *   - `BOUNTY_IM_ADDRESS` env var is REMOVED.
 *   - `resolveCurrentAgent` / `resolveCurrentAgentAddress` helpers are
 *     DEPRECATED — they return `undefined` unconditionally now (callers
 *     should use `requireEmailFlag` + `ProfileContext.active.email`
 *     instead).
 *   - Active identity resolution is driven EXCLUSIVELY by the
 *     `ProfileContext.active.email` field, which `bounty profile use`
 *     populates from a registered email.
 *
 * Migration:
 *   - `bounty profile use <name>` — sets active identity (email).
 *   - `requireEmailFlag` helper (src/cli/lib/email-flag.ts) handles the
 *     explicit `--email` / `--publisher-email` precedence + ProfileContext
 *     fallback, with friendly errors when neither is available.
 */

import { readAuthToken } from './auth-token.js';

export interface ResolveCurrentAgentOptions {
  /**
   * @deprecated Retained for API compatibility; ignored in v0.14.
   */
  tokenPath?: string;
}

/**
 * @deprecated v0.14: returns `undefined` unconditionally. Use
 * `requireEmailFlag` + `ProfileContext.active.email` instead.
 */
export function resolveCurrentAgent(
  _options: ResolveCurrentAgentOptions = {}
): string | undefined {
  // v0.14: BOUNTY_IM_ADDRESS removed; token-file based uuid extraction
  // is no longer part of the v0.14 contract. Returning `undefined`
  // forces callers to use the v0.14 fallback path (ProfileContext.email).
  //
  // The token file presence check is kept as a no-op for binary
  // compatibility with legacy tests that assert behaviour on it.
  // (No email extraction — agent uuid is server-side concern only.)
  readAuthToken(_options.tokenPath);
  return undefined;
}

/**
 * @deprecated v0.14: returns `undefined` unconditionally.
 */
export function resolveCurrentAgentAddress(
  _options: ResolveCurrentAgentOptions = {}
): { uuid: string; host: string; raw: string } | undefined {
  return undefined;
}
