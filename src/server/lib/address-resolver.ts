/**
 * Address parser/resolver for bounty-server v0.10+ / v0.13+.
 *
 * v0.10 BREAKING: This module now strictly requires `<uuid>@<host>` format.
 * Bare UUIDs are NO LONGER accepted. Use `parseAddress` from `../../lib/address.js`
 * for the canonical parser; this module is a thin DB-aware wrapper.
 *
 * Address format: `<uuid>@<host>` (e.g. `ee0dd085-...@bounty.tongagents.example.com`).
 * The local part (`uuid`) IS the agent's primary key in `agents.id`.
 *
 * v0.13: Email-first resolution. Server endpoints now accept the registered
 * email (agents.email UNIQUE column) as the primary lookup key. The legacy
 * `<uuid>@<host>` form is preserved as a secondary lookup path for callers
 * that have not yet migrated.
 */

import { parseAddress } from '../../lib/address.js';
import type { Database } from '../../lib/storage/database.js';

/**
 * RFC-5322-ish email regex: very loose but rejects obvious garbage
 * (multiple `@`, whitespace, empty local/domain). Used to distinguish
 * "looks like an email" from "looks like an address" at the entry point.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AddressParts {
  /** The agent UUID (local part of address). */
  uuid: string;
  /** The host portion. */
  host: string;
  /** The original input string (trimmed). */
  raw: string;
}

/**
 * Strictly parse an agent address.
 *
 * Returns `null` if the input is empty / not a string / does NOT match
 * the canonical `<uuid>@<host>` format.
 *
 * v0.10 BREAKING: rejects bare UUIDs (which were accepted in v0.7-v0.9).
 *
 * @example
 *   parseAgentAddress('abc@host.com')  // → { uuid: 'abc', host: 'host.com', raw: 'abc@host.com' }
 *   parseAgentAddress('abc')            // → null (BREAKING: was { uuid: 'abc', host: undefined })
 *   parseAgentAddress('')               // → null
 *   parseAgentAddress(null)             // → null
 */
export function parseAgentAddress(input: unknown): AddressParts | null {
  const r = parseAddress(input);
  return r.ok ? r.value : null;
}

/**
 * Look up an agent by address (v0.10 STRICT).
 *
 * Requires a full `uuid@host` address — bare UUIDs are no longer accepted.
 * Returns `{ id, email, address }` on hit, or `null` on miss / invalid input.
 *
 * Strategy: exact match on `agents.address` (the full uuid@host column).
 *
 * @example
 *   findAgentByAddress(db, 'uuid-1@bounty.local')  // → { id: 'uuid-1', email: 'alice@...', address: 'uuid-1@bounty.local' }
 *   findAgentByAddress(db, 'uuid-1')               // → null (BREAKING)
 *   findAgentByAddress(db, 'nope')                 // → null
 */
export function findAgentByAddress(
  db: Database,
  input: unknown
): { id: string; email: string; address: string } | null {
  const parts = parseAgentAddress(input);
  if (!parts) return null;

  // Full address: require EXACT match on the `address` column.
  // No fallback to bare id lookup (v0.10 BREAKING).
  const row = db
    .prepare('SELECT id, email, address FROM agents WHERE address = ?')
    .get(parts.raw) as { id: string; email: string; address: string } | undefined;
  return row ?? null;
}

/**
 * v0.13: Look up an agent by email (the registered agents.email column).
 *
 * Returns `{ id, email, address }` on hit, or `null` on miss / invalid input.
 * Only accepts string inputs that look like an email (contain `@` and a `.`
 * in the domain). UUID-style or address-style inputs are intentionally
 * returned as `null` so the caller can fall back to `findAgentByAddress`.
 *
 * @example
 *   findAgentByEmail(db, 'alice@example.com')      // → { id, email, address }
 *   findAgentByEmail(db, 'noone@example.com')      // → null
 *   findAgentByEmail(db, '')                       // → null
 *   findAgentByEmail(db, 'uuid-1@bounty.local')    // → null (use findAgentByAddress)
 */
export function findAgentByEmail(
  db: Database,
  input: unknown
): { id: string; email: string; address: string } | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  // Reject inputs that look like the legacy `<uuid>@<host>` address form.
  // We dispatch to `findAgentByAddress` for those via the caller.
  if (!EMAIL_RE.test(raw)) return null;
  const row = db
    .prepare('SELECT id, email, address FROM agents WHERE email = ?')
    .get(raw) as { id: string; email: string; address: string } | undefined;
  return row ?? null;
}

/**
 * v0.13: Resolve an agent by EITHER email (preferred) OR `<uuid>@<host>` address.
 *
 * Returns `{ id, email, address }` on hit, or `null` on miss / invalid input.
 * Used by every server endpoint that previously required the address field,
 * so callers can migrate to the email flag at their own pace.
 *
 * Lookup priority:
 *   1. `findAgentByEmail` — accepts registered email like `alice@example.com`
 *   2. `findAgentByAddress` — falls back to legacy `<uuid>@<host>`
 */
export function findAgentByEmailOrAddress(
  db: Database,
  input: unknown
): { id: string; email: string; address: string } | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  return findAgentByEmail(db, raw) ?? findAgentByAddress(db, raw);
}