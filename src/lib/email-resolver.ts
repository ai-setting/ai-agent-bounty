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
 *   - `parseEmail` returns a discriminated result with a helpful hint so
 *     callers can guide end users to the right input.
 *   - `findAgentByEmail` returns the canonical row triple
 *     (`{id, email, address}`) where `address` is the internal `<uuid>@<host>`
 *     used by IM routing / DB writes.
 *   - `formatCanonicalAddress` is a pure helper retained for IM push / DB
 *     writes; callers MUST NOT use it to construct user-facing input.
 *
 * Boundary strictness (v0.14):
 *   - NO implicit trim: leading/trailing whitespace is rejected.
 *   - NO label relaxation: every domain label must be non-empty; no
 *     consecutive dots; no leading/trailing dot in the domain.
 *   - One `@` only (multi-@ rejected).
 *
 * Test matrix (see tests/server/email-resolver.test.ts):
 *   - accept: alice@example.com, alice+tag@host.example.com, a.b-c@x.y.example
 *   - reject <uuid>@<host>: 8de9b6aa-5781-4000-8000-000000000001@bounty.local
 *   - reject bare UUID:     8de9b6aa-5781-4000-8000-000000000001
 *   - reject empty/whitespace/null/undefined/42/{}
 *   - reject surrounding whitespace: " alice@example.com", "alice@example.com "
 *   - reject malformed:     alice@, @example.com, alice.example.com, alice@@b.com
 *   - reject malformed domain: alice@.example.com, alice@example..com,
 *                              alice@example.com., alice@.com, alice@example.,
 *                              alice@., alice@..
 *   - reject oversize:      250*'a'@example.com (261 chars)
 *
 * @module email-resolver
 */

import type { Database } from "./storage/database.js";

/**
 * Strict email regex (v0.14 boundary):
 *   - Local part: 1+ non-whitespace non-`@` chars
 *   - `@`
 *   - Domain: at least two non-empty labels, no leading/trailing dot,
 *     no consecutive dots, no `@` in any label. Each label is 1+
 *     non-whitespace non-`.` non-`@` chars.
 *
 * The regex itself cannot distinguish `<uuid>@<host>` from
 * `alice@example.com`; `parseEmail` adds an extra UUID-local-part check
 * to reject the legacy form.
 */
const EMAIL_RE =
  /^[^\s@]+@(?:[^\s@.]+\.)+[^\s@.]+$/;

/**
 * UUID-shaped local part: 8-4-4-4-12 hex. Used to reject `<uuid>@<host>`
 * as input even though the email regex would otherwise accept it.
 */
const UUID_LOCAL_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whitespace anywhere in the candidate. v0.14 rejects — no implicit trim.
 */
const WHITESPACE_RE = /\s/;

/** DNS-imposed maximum total length of an email address (RFC 5321 §4.5.3.1.3). */
const MAX_EMAIL_LEN = 254;

export type EmailValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Surface for the remediation hint. CLI surfaces prefix the field with
 * `--`; HTTP body surfaces use the raw field name so callers can mention
 * it in 400 responses without producing CLI-shaped text.
 */
export type HintSurface = "cli" | "http";

/**
 * Convert a camelCase / PascalCase identifier to kebab-case for CLI flag hints.
 *   "publisherEmail" → "publisher-email"
 *   "agentEmail"     → "agent-email"
 *   "email"          → "email"
 * Already-kebab / single-word identifiers are returned unchanged.
 */
function dasherize(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * Build the surface-appropriate remediation hint. Centralised so the
 * CLI / server can grep on a stable phrase per surface.
 *
 *   cli:  "use --publisher-email <your-registered-email>"
 *   http: "use publisherEmail: <your-registered-email>"
 */
export function hintFor(field: string, surface: HintSurface = "cli"): string {
  const cliField = dasherize(field);
  return surface === "cli"
    ? `use --${cliField} <your-registered-email>`
    : `use ${field}: <your-registered-email>`;
}

/**
 * Build a typed rejection with a surface-appropriate hint.
 *
 * HTTP-surface rejections intentionally do NOT prefix `--` on camelCase
 * fields (e.g. `publisherEmail`) so the 400 response stays HTTP-shaped
 * rather than CLI-shaped.
 */
function reject(
  field: string,
  reason: string,
  surface: HintSurface = "cli",
): EmailValidationResult {
  return { ok: false, error: `✗ ${field} ${reason}; ${hintFor(field, surface)}` };
}

/**
 * Strictly validate an input string as a registered-shape email.
 *
 * v0.14 BREAKING:
 *   - Rejects `<uuid>@<host>` (UUID local part)
 *   - Rejects bare UUIDs (no `@`)
 *   - Rejects empty / whitespace-only / non-string inputs
 *   - Rejects surrounding whitespace (no implicit trim)
 *   - Rejects malformed domain (empty / consecutive / leading / trailing dot)
 *   - Rejects oversize (> DNS 254-char cap)
 *
 * @param input - The candidate string (CLI flag value or HTTP body field).
 * @param field - Field name used to build the error message
 *   (e.g. `"email"`, `"publisherEmail"`).
 * @param surface - Which surface this input came from; drives the
 *   remediation hint shape (CLI uses `--flag`, HTTP uses `field:`).
 */
export function parseEmail(
  input: unknown,
  field = "email",
  surface: HintSurface = "cli",
): EmailValidationResult {
  if (typeof input !== "string") {
    return reject(field, `must be a registered email (got ${typeof input})`, surface);
  }
  if (input.length === 0) {
    return reject(field, "requires a non-empty registered email", surface);
  }
  if (input.length > MAX_EMAIL_LEN) {
    return reject(
      field,
      `exceeds ${MAX_EMAIL_LEN}-char limit (got ${input.length})`,
      surface,
    );
  }
  // v0.14 strict: NO implicit trim. Reject any whitespace anywhere.
  if (WHITESPACE_RE.test(input)) {
    return reject(
      field,
      `must not contain whitespace (got "${input}")`,
      surface,
    );
  }
  // Reject legacy address form: local part shaped like a UUID.
  const at = input.indexOf("@");
  if (at > 0 && UUID_LOCAL_RE.test(input.slice(0, at))) {
    return reject(
      field,
      `looks like a legacy <uuid>@<host> address ("${input}")`,
      surface,
    );
  }
  if (!EMAIL_RE.test(input)) {
    return reject(
      field,
      `must be a registered email in local@domain.tld form (got "${input}")`,
      surface,
    );
  }
  return { ok: true, value: input };
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
