/**
 * Address parser/resolver for bounty-server v0.7.
 * Phase: feat/bounty-task-optimize
 *
 * Address format: `<uuid>@<host>` (e.g. `ee0dd085-...@bounty.tongagents.example.com`).
 * Bare UUID (no `@host`) is also accepted for backward compatibility — it
 * means "find by id directly".
 */

export interface AddressParts {
  /** The agent UUID (or bare id). */
  uuid: string;
  /** The host portion (`undefined` if input had no `@`). */
  host: string | undefined;
  /** The original input string (trimmed). */
  raw: string;
}

/**
 * Parse an agent address into its parts.
 *
 * Returns `null` if the input is empty / not a string / cannot yield a
 * non-empty uuid. Never throws — callers should treat `null` as
 * "address not provided / invalid".
 *
 * @example
 *   parseAgentAddress('abc@host.com')  // { uuid: 'abc', host: 'host.com', raw: 'abc@host.com' }
 *   parseAgentAddress('abc')            // { uuid: 'abc', host: undefined, raw: 'abc' }
 *   parseAgentAddress('')               // null
 *   parseAgentAddress(null)             // null
 */
export function parseAgentAddress(input: unknown): AddressParts | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;

  const atIdx = raw.indexOf('@');
  if (atIdx === -1) {
    // bare id (backward compatible)
    return { uuid: raw, host: undefined, raw };
  }

  const uuid = raw.slice(0, atIdx).trim();
  const host = raw.slice(atIdx + 1).trim();
  if (!uuid || !host) return null;

  return { uuid, host, raw };
}

import type { Database } from '../../lib/storage/database.js';

/**
 * Look up an agent by address.
 *
 * Strategy:
 * 1. If the input is a full address (`uuid@host`), match `agents.address` exactly.
 * 2. If the input is a bare UUID (no `@`), match `agents.id` directly.
 *
 * Returns `{ id, email }` on hit, or `null` on miss / invalid input.
 *
 * @example
 *   findAgentByAddress(db, 'uuid-1@bounty.local')  // → { id: 'uuid-1', email: 'alice@...' }
 *   findAgentByAddress(db, 'uuid-1')              // → { id: 'uuid-1', email: 'alice@...' }
 *   findAgentByAddress(db, 'nope')                // → null
 */
export function findAgentByAddress(
  db: Database,
  input: unknown
): { id: string; email: string } | null {
  const parts = parseAgentAddress(input);
  if (!parts) return null;

  if (parts.host !== undefined) {
    // Full address: require EXACT match on the `address` column.
    // We deliberately do NOT fall back to id lookup when host is present —
    // a mismatched host should be treated as "address not found" for
    // security (the caller is asserting a specific identity, not just an id).
    const row = db
      .prepare('SELECT id, email FROM agents WHERE address = ?')
      .get(parts.raw) as { id: string; email: string } | undefined;
    return row ?? null;
  }

  // Bare UUID (no @host): match by id directly.
  const row = db
    .prepare('SELECT id, email FROM agents WHERE id = ?')
    .get(parts.uuid) as { id: string; email: string } | undefined;
  return row ?? null;
}
