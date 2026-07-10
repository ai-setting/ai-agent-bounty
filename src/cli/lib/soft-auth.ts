/**
 * Soft auth header helper.
 *
 * New v0.7 behavior: CLI requests may attach a saved token when present, but
 * missing/empty/unreadable token files must never block the request. The
 * server decides whether an endpoint requires authentication.
 */

import { DEFAULT_TOKEN_PATH, readAuthToken } from './auth-token.js';

export interface SoftAuthResult {
  headers: Record<string, string>;
  hasToken: boolean;
}

export function attachSoftAuth(
  headers: Record<string, string> = {},
  tokenPath: string = DEFAULT_TOKEN_PATH
): SoftAuthResult {
  const nextHeaders = { ...headers };
  const token = readAuthToken(tokenPath);

  if (token) {
    nextHeaders.Authorization = `Bearer ${token}`;
    return { headers: nextHeaders, hasToken: true };
  }

  return { headers: nextHeaders, hasToken: false };
}
