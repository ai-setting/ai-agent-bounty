/**
 * CLI address parsing helpers (v0.10+).
 *
 * v0.10 BREAKING: All CLI commands MUST use `<uuid>@<host>` format for
 * `--*-address` flags. Bare UUID, email-like, and empty inputs are rejected.
 *
 * This module is now a thin re-export of the shared `src/lib/address.js`
 * to ensure server and CLI use the exact same validation logic.
 *
 * @deprecated Use the shared `parseAddress`/`formatAddress`/`isValidAddress`
 * from `../../lib/address.js` directly. This re-export is kept for backward
 * compatibility with CLI command files that import `parseAgentAddress`.
 */

import {
  parseAddress,
  formatAddress,
  isValidAddress,
  type Address,
  type AddressValidationResult,
} from '../../lib/address.js';

export {
  parseAddress,
  formatAddress,
  isValidAddress,
  type Address,
  type AddressValidationResult,
};

/**
 * Backward-compatible alias used by CLI command files.
 *
 * In v0.10 this returns the same `{ ok, value } | { ok, error }` shape as
 * the shared `parseAddress`. Note that:
 * - `field` defaults to `--agent-address` for error messages.
 * - The returned `value` shape matches the v0.7 CLI expectations
 *   (`{ uuid, host, address }`) — the v0.10 strict `Address` has `raw` instead
 *   of `address`. We expose both for compatibility.
 */
export { parseAddress as parseAgentAddress } from '../../lib/address.js';

/**
 * **v0.10 unified helper.** Replaces the deprecated `resolveAgentIdOption`.
 *
 * Resolve the acting agent's full `<uuid>@<host>` address from:
 *   1. Explicit `--*-address` flag value (preferred)
 *   2. `fallback` (e.g. BOUNTY_IM_ADDRESS-derived full address)
 *
 * v0.10 BREAKING: returns the full `{ uuid, host, raw }` triple, NOT just
 * the uuid. Callers should send `raw` in `body[*Address]` and use `uuid`
 * for `X-Agent-Id` header (soft-auth compatibility).
 *
 * @example
 *   const r = resolveAddressOption({
 *     address: argv['publisher-address'],
 *     fallback: resolveCurrentAgentAddress(),
 *     addressFlag: '--publisher-address',
 *   });
 *   if (!r.ok) { console.error(r.error); process.exit(2); }
 *   body.publisherAddress = r.value.raw;       // full uuid@host
 *   headers['X-Agent-Id'] = r.value.uuid;      // soft-auth uses uuid only
 */
export interface ResolveAddressOptionInput {
  /** Preferred address flag value (argv['agent-address'] etc.). */
  address?: unknown;
  /** Fallback value (e.g. resolved BOUNTY_IM_ADDRESS). */
  fallback?: unknown;
  /** Flag name for error messages (e.g. `--agent-address`). */
  addressFlag: string;
  /** Optional missing-value message (defaults to flag required). */
  missingMessage?: string;
}

export interface AddressResolution {
  uuid: string;
  host: string;
  raw: string;
}

export type AddressOptionResult =
  | { ok: true; value: AddressResolution }
  | { ok: false; error: string };

export function resolveAddressOption(
  input: ResolveAddressOptionInput
): AddressOptionResult {
  // Accept either a string (raw uuid@host) OR an already-parsed Address triple
  // (e.g. returned by `resolveCurrentAgentAddress()`).
  const parseValue = (val: unknown, field: string): { ok: true; value: AddressResolution } | { ok: false; error: string } => {
    if (val && typeof val === 'object' && 'uuid' in val && 'host' in val && 'raw' in val) {
      const obj = val as AddressResolution;
      return { ok: true, value: { uuid: obj.uuid, host: obj.host, raw: obj.raw } };
    }
    const r = parseAddress(val, field);
    if (!r.ok) {
      return { ok: false, error: r.error };
    }
    return { ok: true, value: r.value };
  };

  // Priority 1: explicit address flag
  if (input.address !== undefined && input.address !== null && input.address !== '') {
    const r = parseValue(input.address, input.addressFlag);
    return r.ok ? r : { ok: false, error: r.error };
  }

  // Priority 2: fallback (env, token-derived full address, etc.)
  if (input.fallback !== undefined && input.fallback !== null && input.fallback !== '') {
    const r = parseValue(input.fallback, input.addressFlag);
    return r.ok ? r : { ok: false, error: r.error };
  }

  return {
    ok: false,
    error:
      (input.missingMessage ? `${input.missingMessage} (${input.addressFlag})` : null) ??
      `✗ ${input.addressFlag} is required (<uuid>@<host> format).`,
  };
}
