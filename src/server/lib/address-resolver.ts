/**
 * Address parser/resolver for bounty-server v0.10+.
 *
 * v0.10 BREAKING: This module now strictly requires `<uuid>@<host>` format.
 * Bare UUIDs are NO LONGER accepted. Use `parseAddress` from `../../lib/address.js`
 * for the canonical parser; this module is a thin DB-aware wrapper.
 *
 * Address format: `<uuid>@<host>` (e.g. `ee0dd085-...@bounty.tongagents.example.com`).
 * The local part (`uuid`) IS the agent's primary key in `agents.id`.
 */

import { parseAddress } from '../../lib/address.js';
import type { Database } from '../../lib/storage/database.js';

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