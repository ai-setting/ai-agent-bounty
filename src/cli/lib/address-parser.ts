/**
 * Helpers for v0.7 address-based agent identity CLI flags.
 *
 * Preferred CLI input is `<uuid>@<host>` (agent address). For backward
 * compatibility we also accept the old pure id/uuid form and extract the
 * local part before sending legacy `agentId` / `publisherId` fields to the
 * server.
 */

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; field: string };

export interface ParsedAgentAddress {
  /** Local id portion before @; named uuid to match server model. */
  uuid: string;
  /** Host portion after @, absent for legacy pure-id input. */
  host?: string;
  /** Trimmed original input. */
  address: string;
}

function printable(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  return String(value);
}

/**
 * Parse an agent address or legacy pure id.
 *
 * Accepts:
 * - `ee0...c1e6@bounty.example.com` → uuid `ee0...c1e6`, host `bounty.example.com`
 * - `ee0...c1e6` → uuid `ee0...c1e6`, host undefined (legacy compatibility)
 */
export function parseAgentAddress(
  input: unknown,
  field = '--agent-address'
): ValidationResult<ParsedAgentAddress> {
  if (typeof input !== 'string') {
    return {
      ok: false,
      field,
      error: `✗ ${field} must be a string (got ${printable(input)})`,
    };
  }

  const address = input.trim();
  if (!address) {
    return {
      ok: false,
      field,
      error: `✗ ${field} requires a value (got nothing)`,
    };
  }

  const firstAt = address.indexOf('@');
  const lastAt = address.lastIndexOf('@');

  if (firstAt === -1) {
    return { ok: true, value: { uuid: address, address } };
  }

  if (firstAt !== lastAt) {
    return {
      ok: false,
      field,
      error: `✗ ${field} must be <uuid>@<host> or <uuid> (got ${printable(address)})`,
    };
  }

  const uuid = address.slice(0, firstAt).trim();
  const host = address.slice(firstAt + 1).trim();

  if (!uuid) {
    return {
      ok: false,
      field,
      error: `✗ ${field} is missing agent id before @ (got ${printable(address)})`,
    };
  }

  if (!host) {
    return {
      ok: false,
      field,
      error: `✗ ${field} is missing host after @ (got ${printable(address)})`,
    };
  }

  return { ok: true, value: { uuid, host, address } };
}

export interface ResolveAgentIdOptionInput {
  /** Preferred address flag value, e.g. argv['agent-address']. */
  address?: unknown;
  /** Deprecated id flag value, e.g. argv['agent-id']. */
  deprecatedId?: unknown;
  /** Fallback value from env/token inference. */
  fallback?: unknown;
  /** Preferred flag name for messages. */
  addressFlag: string;
  /** Deprecated flag name for messages. */
  deprecatedFlag: string;
  /** Optional missing-value message. */
  missingMessage?: string;
  /** Warning hook; defaults to console.warn. */
  warn?: (message: string) => void;
}

/**
 * Resolve preferred address / deprecated id / fallback into a server id.
 * Emits a deprecation warning only when the deprecated flag was used and the
 * preferred address flag was not supplied.
 */
export function resolveAgentIdOption(
  input: ResolveAgentIdOptionInput
): ValidationResult<string> {
  const warn = input.warn ?? console.warn;

  if (input.address !== undefined && input.address !== null) {
    const parsed = parseAgentAddress(input.address, input.addressFlag);
    return parsed.ok
      ? { ok: true, value: parsed.value.uuid }
      : { ok: false, field: parsed.field, error: parsed.error };
  }

  if (input.deprecatedId !== undefined && input.deprecatedId !== null) {
    warn(`⚠ ${input.deprecatedFlag} is deprecated; use ${input.addressFlag} instead.`);
    const parsed = parseAgentAddress(input.deprecatedId, input.deprecatedFlag);
    return parsed.ok
      ? { ok: true, value: parsed.value.uuid }
      : { ok: false, field: parsed.field, error: parsed.error };
  }

  if (input.fallback !== undefined && input.fallback !== null) {
    const parsed = parseAgentAddress(input.fallback, input.addressFlag);
    return parsed.ok
      ? { ok: true, value: parsed.value.uuid }
      : { ok: false, field: parsed.field, error: parsed.error };
  }

  return {
    ok: false,
    field: input.addressFlag,
    error: input.missingMessage ?? `✗ ${input.addressFlag} is required`,
  };
}
