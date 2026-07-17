/**
 * v0.14 strict email-flag helper.
 *
 * Centralised CLI surface for "actor identity is the registered email" lookup.
 * Three exports:
 *
 *   - `requireEmailFlag(field, argv)` — strict email boundary that
 *       resolves from `argv[field]` or `argv[shortAlias]` (kebab-cased).
 *       Returns `{ok, value}` | `{ok:false, error}` with a friendly
 *       "use --xxx-email <your-registered-email>" hint. v0.14 strict —
 *       does NOT silently fall back to `BOUNTY_IM_ADDRESS` /
 *       `resolveCurrentAgent` / legacy address. Used by all
 *       `bounty-task/*` and `com/send` identity checks.
 *
 *   - `resolveActiveProfileEmail()` — returns the active profile's
 *       `email` if available; otherwise `undefined`. Soft variant used by
 *       `requireEmailFlag` for fallback resolution.
 *
 *   - `parseEmailFromArgv(argv, field)` — low-level helper that mirrors
 *       the boundary strictness at command sites that already know they
 *       do not want the profile fallback (e.g. `auth/login`).
 *
 * Precedence:
 *   1. explicit `argv[field]` (or kebab-cased alias) if present + valid email
 *   2. ProfileContext.active.email if present + valid email
 *   3. friendly error hint with both `--email` and `profile use` paths
 *
 * Empty string is treated as "not supplied" (fall through) so that
 * `bounty task grab --email ""` does not silently bypass validation.
 */

import chalk from 'chalk';
import {
  parseEmail,
  hintFor,
  type HintSurface,
} from '../../lib/email-resolver.js';
import { ProfileContext } from '../config/context.js';

export type EmailFlagResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/** Aliases the CLI binds to `--email`. v0.14 = `-e`. */
const DEFAULT_SHORT_ALIAS = 'e';

/**
 * Try to read a candidate value from argv, accepting both the canonical
 * field (`--email`, `--publisher-email`) and the short alias (`-e`).
 *
 * Empty string is treated as "not present" — falls through to profile
 * / error path rather than failing validation.
 */
function readArgvField(
  argv: Record<string, unknown>,
  field: string,
  shortAlias: string = DEFAULT_SHORT_ALIAS
): string | undefined {
  for (const key of [field, shortAlias]) {
    const v = argv[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

/** Re-export the kebab-case CLI hint from email-resolver so callers can
 *  build error messages in one place. */
export { hintFor };

/**
 * Resolve the active profile's `email` (if any).
 *
 * Returns the email string when:
 *   - `ProfileContext.getActive()` is non-null AND
 *   - the profile's `email` field is a non-empty string.
 * Otherwise `undefined` (do not throw — callers decide if this is fatal).
 */
export function resolveActiveProfileEmail(): string | undefined {
  const profile = ProfileContext.getActive();
  if (!profile) return undefined;
  const email = profile.email;
  if (typeof email === 'string' && email.trim()) return email.trim();
  return undefined;
}

/**
 * Lower-level boundary helper that ONLY reads the explicit argv field.
 * Does NOT fall back to the profile — used by callers that need strict
 * explicit-only behaviour.
 */
export function parseEmailFromArgv(
  argv: Record<string, unknown>,
  field: string,
  surface: HintSurface = 'cli',
): EmailFlagResult {
  const candidate = readArgvField(argv, field);
  if (!candidate) {
    return {
      ok: false,
      error: `✗ ${field} is required when no active profile is set; ${hintFor(field, surface)} or run \`bounty profile use <name>\``,
    };
  }
  const parsed = parseEmail(candidate, field, surface);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return { ok: true, value: parsed.value };
}

/**
 * Strict email-flag resolver with profile fallback.
 *
 * Precedence:
 *   1. Explicit `argv[field]` (or its short alias) — if present, must
 *      pass `parseEmail` (rejects bare UUIDs, `<uuid>@<host>`, malformed).
 *   2. `ProfileContext.active.email` — used when explicit is missing
 *      OR empty.
 *   3. Friendly error hint with both `--email` and `profile use` paths.
 *
 * Returns a structured result; the caller decides whether to
 * `console.error` + `process.exit(1)`.
 */
export function requireEmailFlag(
  field: string,
  argv: Record<string, unknown>,
  surface: HintSurface = 'cli',
): EmailFlagResult {
  const candidate = readArgvField(argv, field);

  if (candidate) {
    const parsed = parseEmail(candidate, field, surface);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    return { ok: true, value: parsed.value };
  }

  // No explicit value — try profile fallback.
  const profileEmail = resolveActiveProfileEmail();
  if (profileEmail) {
    const parsed = parseEmail(profileEmail, field, surface);
    if (parsed.ok) return { ok: true, value: parsed.value };
  }

  return {
    ok: false,
    error: `✗ ${field} is required; ${hintFor(field, surface)} or run \`bounty profile use <name>\``,
  };
}

/**
 * Convenience: render a friendly error from a `requireEmailFlag` result
 * and exit the process with code 1.
 *
 * Used by `bounty-task/*` command handlers that prefer a single-call
 * helper vs. inline `console.error` + `process.exit`.
 */
export function exitWithEmailFlagError(result: EmailFlagResult): never {
  if (result.ok) {
    // Should be impossible — callers only invoke on failure paths.
    process.exit(0);
  }
  console.error(chalk.red(`\n${result.error}\n`));
  process.exit(1);
}
