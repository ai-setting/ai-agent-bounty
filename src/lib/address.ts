/**
 * Agent address shared utilities (v0.10+).
 *
 * Canonical format: `<uuid>@<host>`. Both halves are required and non-empty.
 * The local part (`uuid`) IS the agent's primary key in the `agents` table;
 * the `host` part is used by IM/web routing/forwarding.
 *
 * v0.10 BREAKING: bare UUIDs, email-like strings, and empty values are REJECTED.
 *
 * @module address
 */

/**
 * Strict UUID format (RFC 4122 v1-v5):
 * - 8-4-4-4-12 hex
 * - Version digit (1-5) at position 13
 * - Variant (8, 9, a, b) at position 17
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Host format: 1+ labels of `[a-z0-9]` (with optional internal hyphens) joined by dots.
 *
 * Examples that match: `bounty.example.com`, `localhost`, `a.b.c.d.example.com`, `my-host.example.com`
 * Examples that don't match: `bad__host`, `-bad.com`, `bad-.com`, `` (empty)
 */
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

export interface Address {
  /** Local part — equal to `agents.id`. System-wide unique id. */
  uuid: string;
  /** Host part — IM/web routing destination for this agent. */
  host: string;
  /** Original trimmed input string, preserved for downstream comparison. */
  raw: string;
}

export type AddressValidationResult =
  | { ok: true; value: Address }
  | { ok: false; error: string };

/**
 * Strictly parse an input string as a `uuid@host` address.
 *
 * v0.10 BREAKING: rejects bare UUIDs, email-like strings, empty input,
 * non-string inputs, missing uuid/host parts, and multiple `@` characters.
 *
 * @param input - The candidate string (typically from CLI flag or HTTP body)
 * @param field - Field name for error messages (e.g. `--agent-address`, `publisherAddress`)
 * @returns `{ ok: true, value: { uuid, host, raw } }` or `{ ok: false, error }`
 *
 * @example
 *   parseAddress('ee0dd085-...@bounty.example.com')
 *     // → { ok: true, value: { uuid: 'ee0dd085-...', host: 'bounty.example.com', raw: '...' } }
 *   parseAddress('ee0dd085-...')  // bare UUID → { ok: false, error: 'must be <uuid>@<host>' }
 *   parseAddress('')              // empty → { ok: false, error: 'requires a value (got empty)' }
 *   parseAddress(null)            // non-string → { ok: false, error: 'must be a string' }
 */
export function parseAddress(input: unknown, field = 'address'): AddressValidationResult {
  if (typeof input !== 'string') {
    return { ok: false, error: `✗ ${field} must be a string (got ${typeof input})` };
  }
  const raw = input.trim();
  if (!raw) {
    return { ok: false, error: `✗ ${field} requires a value (got empty)` };
  }
  const at = raw.indexOf('@');
  if (at === -1) {
    return { ok: false, error: `✗ ${field} must be in <uuid>@<host> format (got "${raw}")` };
  }
  if (at !== raw.lastIndexOf('@')) {
    return { ok: false, error: `✗ ${field} has multiple '@' (got "${raw}")` };
  }
  const uuid = raw.slice(0, at).trim();
  const host = raw.slice(at + 1).trim();
  if (!uuid) {
    return { ok: false, error: `✗ ${field} missing uuid before '@' (got "${raw}")` };
  }
  if (!host) {
    return { ok: false, error: `✗ ${field} missing host after '@' (got "${raw}")` };
  }
  if (!UUID_RE.test(uuid)) {
    return { ok: false, error: `✗ ${field} uuid part is not a valid uuid (got "${uuid}")` };
  }
  if (!HOST_RE.test(host)) {
    return { ok: false, error: `✗ ${field} host part is not a valid host (got "${host}")` };
  }
  return { ok: true, value: { uuid, host, raw } };
}

/**
 * Compose a `uuid@host` address string.
 */
export function formatAddress(uuid: string, host: string): string {
  return `${uuid}@${host}`;
}

/**
 * Convenience boolean wrapper around {@link parseAddress}.
 */
export function isValidAddress(input: unknown): boolean {
  return parseAddress(input).ok;
}