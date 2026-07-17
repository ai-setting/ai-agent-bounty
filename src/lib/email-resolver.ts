/**
 * v0.14 strict email-only resolver.
 *
 * Single source of truth for actor identity at the server / CLI boundary.
 * Replaces the v0.13 dual-path resolver that accepted either email OR
 * `<uuid>@<host>` form.
 *
 * Contract:
 *   - Input MUST be a registered email shape (`local@domain.tld`).
 *   - `<uuid>@<host>` and bare UUIDs are REJECTED — no silent fallback.
 *   - `parseEmail` returns a discriminated result with a helpful "use --email"
 *     hint so callers can guide end users.
 *   - `findAgentByEmail` returns the canonical row triple
 *     (`{id, email, address}`) where `address` is the internal `<uuid>@<host>`
 *     used by IM routing / DB writes.
 *   - `formatCanonicalAddress` is a pure helper retained for IM push / DB
 *     writes; callers MUST NOT use it to construct user-facing input.
 *
 * Test matrix (see tests/server/email-resolver.test.ts):
 *   - accept: alice@example.com, alice+tag@host.example.com, a.b-c@x.y.example
 *   - reject <uuid>@<host>: 8de9b6aa-5781-4000-8000-000000000001@bounty.local
 *   - reject bare UUID:     8de9b6aa-5781-4000-8000-000000000001
 *   - reject empty/whitespace/null/undefined/42/{}
 *   - reject malformed:     alice@, @example.com, alice.example.com, alice@@b.com
 *   - reject oversize:      250*'a'@example.com (261 chars)
 *
 * @module email-resolver
 */

import type { Database } from "./storage/database.js";

/**
 * Strict RFC-5322-ish email regex:
 *   - One `@`
 *   - Non-empty local part (no whitespace, no `@`)
 *   - Non-empty domain with at least one `.` (each label non-empty)
 *   - The regex itself cannot distinguish `<uuid>@<host>` from
 *     `alice@example.com`; `parseEmail` adds an extra UUID-local-part check
 *     to reject the legacy form.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * UUID-shaped local part: 8-4-4-4-12 hex. Used to reject `<uuid>@<host>`
 * as input even though the email regex would otherwise accept it.
 */
const UUID_LOCAL_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DNS-imposed maximum total length of an email address (RFC 5321 §4.5.3.1.3). */
const MAX_EMAIL_LEN = 254;

export type EmailValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Build the "use --<field>" remediation hint appended to every rejection.
 * Centralised so the CLI / server can grep on a single phrase.
 */
function hintFor(field: string): string {
  return `use --${field} <your-registered-email>`;
}

/**
 * Build a typed rejection with a consistent "use --<field>" hint.
 */
function reject(field: string, reason: string): EmailValidationResult {
  return { ok: false, error: `✗ ${field} ${reason}; ${hintFor(field)}` };
}

/**
 * Strictly validate an input string as a registered-shape email.
 *
 * v0.14 BREAKING: rejects `<uuid>@<host>` and bare UUIDs.
 *
 * @param input - The candidate string (CLI flag value or HTTP body field).
 * @param field - Field name used to build the error message
 *   (e.g. `"email"`, `"publisherEmail"`).
 */
export function parseEmail(input: unknown, field = "email"): EmailValidationResult {
  if (typeof input !== "string") {
    return reject(field, `must be a registered email (got ${typeof input})`);
  }
  const raw = input.trim();
  if (!raw) {
    return reject(field, "requires a non-empty registered email");
  }
  if (raw.length > MAX_EMAIL_LEN) {
    return reject(field, `exceeds ${MAX_EMAIL_LEN}-char limit (got ${raw.length})`);
  }
  // Reject legacy address form: local part shaped like a UUID.
  const at = raw.indexOf("@");
  if (at > 0 && UUID_LOCAL_RE.test(raw.slice(0, at))) {
    return reject(field, `looks like a legacy <uuid>@<host> address ("${raw}")`);
  }
  if (!EMAIL_RE.test(raw)) {
    return reject(field, `must be a registered email in local@domain.tld form (got "${raw}")`);
  }
  return { ok: true, value: raw };
}

export interface AgentRow {
  /** UUID primary key in `agents.id`. */
  id: string;
  /** Registered email from `agents.email`. */
  email: string;
  /** Canonical `<uuid>@<host>` from `agents.address` for IM routing. */
  address: string;
}

/**
 * Look up an agent by registered email.
 *
 * v0.14 BREAKING: returns `null` for `<uuid>@<host>` and bare UUID inputs
 * (no silent fallback to address lookup).
 *
 * @param db - Database handle (canonical `Database` from `./storage/database.js`).
 * @param input - Email string (typically already validated by `parseEmail`).
 */
export function findAgentByEmail(
  db: Database,
  input: unknown,
): AgentRow | null {
  const parsed = parseEmail(input, "email");
  if (!parsed.ok) return null;
  const row = db
    .prepare("SELECT id, email, address FROM agents WHERE email = ?")
    .get(parsed.value) as AgentRow | undefined;
  return row ?? null;
}

/**
 * Compose a canonical `<uuid>@<host>` address string for internal storage.
 *
 * NOT for user-facing input. Use `parseEmail` to validate any user-supplied
 * identifier at the boundary.
 */
export function formatCanonicalAddress(uuid: string, host: string): string {
  return `${uuid}@${host}`;
}
