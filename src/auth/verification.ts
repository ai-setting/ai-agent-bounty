/**
 * Verification Code Logic for Bounty Platform
 *
 * This module provides functions for generating and verifying email verification codes,
 * including rate limiting and code expiration handling.
 *
 * The verification DB is the same Database used by the rest of the
 * platform. We accept the opaque bun:sqlite `Database` instance via a
 * minimal interface (`VerificationDB`) to keep the dependency on
 * bun:sqlite one-way (no type re-export through better-sqlite3).
 */

import { randomBytes } from 'crypto';

const CODE_EXPIRY_HOURS = 24;
const RATE_LIMIT_SECONDS = 60;

export interface RateLimitResult {
  allowed: boolean;
  waitSeconds?: number;
}

export interface VerificationResult {
  valid: boolean;
  error?: string;
  agentId?: string;
}

/**
 * Minimal subset of the bun:sqlite-backed Database API that
 * verification needs. We accept this interface so we do not need
 * to import better-sqlite3 here.
 */
export interface VerificationDB {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number };
  };
}

/**
 * Generate a random 6-digit verification code
 * Uses cryptographically secure random bytes
 *
 * @returns 6-digit string (e.g., "123456" or "001234")
 */
export function generateCode(): string {
  // 6 digits → random in [0, 999999], zero-padded.
  const bytes = randomBytes(4);
  const n = bytes.readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, '0');
}

/**
 * Check rate limit for a given email
 * Returns whether the user can request another code now
 *
 * @param db - Database instance
 * @param email - Email address
 * @returns Rate limit result with allowed flag and optional wait time
 */
export function checkRateLimit(db: VerificationDB, email: string): RateLimitResult {
  const row = db
    .prepare('SELECT created_at FROM verifications WHERE email = ? ORDER BY created_at DESC LIMIT 1')
    .get(email) as { created_at: number } | undefined;

  if (!row) {
    return { allowed: true };
  }

  const elapsed = Math.floor((Date.now() - row.created_at) / 1000);
  if (elapsed < RATE_LIMIT_SECONDS) {
    return { allowed: false, waitSeconds: RATE_LIMIT_SECONDS - elapsed };
  }
  return { allowed: true };
}

/**
 * Create a new verification record
 * Replaces any existing unexpired codes for this agent
 *
 * @param db - Database instance
 * @param agentId - Agent ID
 * @param email - Email address
 * @param code - 6-digit verification code
 */
export function createVerification(
  db: VerificationDB,
  agentId: string,
  email: string,
  code: string
): void {
  // Delete any existing unexpired codes
  db.prepare('DELETE FROM verifications WHERE email = ?').run(email);

  const expiresAt = Date.now() + CODE_EXPIRY_HOURS * 60 * 60 * 1000;

  db.prepare(`
    INSERT INTO verifications (id, agent_id, email, code, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), agentId, email, code, Date.now(), expiresAt);
}

/**
 * Verify a code for a given email
 * Returns the agent_id if valid, or an error message
 *
 * @param db - Database instance
 * @param email - Email address
 * @param code - 6-digit verification code
 * @returns Verification result
 */
export function verifyCode(
  db: VerificationDB,
  email: string,
  code: string
): VerificationResult {
  if (!code || !/^\d{6}$/.test(code)) {
    return { valid: false, error: 'Invalid code format' };
  }

  const row = db
    .prepare(
      'SELECT id, agent_id, code, expires_at FROM verifications WHERE email = ? ORDER BY created_at DESC LIMIT 1'
    )
    .get(email) as
    | { id: string; agent_id: string; code: string; expires_at: number }
    | undefined;

  if (!row) {
    return { valid: false, error: 'No verification code found for this email' };
  }

  if (Date.now() > row.expires_at) {
    return { valid: false, error: 'Verification code has expired' };
  }

  if (row.code !== code) {
    return { valid: false, error: 'Invalid verification code' };
  }

  // Consume the code so it cannot be reused
  db.prepare('DELETE FROM verifications WHERE id = ?').run(row.id);

  return { valid: true, agentId: row.agent_id };
}

/**
 * Get the latest (most recent) verification record for an email
 * Useful for debugging and admin tooling
 *
 * @param db - Database instance
 * @param email - Email address
 * @returns Latest verification record or undefined
 */
export function getLatestVerification(
  db: VerificationDB,
  email: string
):
  | { id: string; agent_id: string; code: string; created_at: number; expires_at: number }
  | undefined {
  const row = db
    .prepare(
      'SELECT id, agent_id, code, created_at, expires_at FROM verifications WHERE email = ? ORDER BY created_at DESC LIMIT 1'
    )
    .get(email) as
    | { id: string; agent_id: string; code: string; created_at: number; expires_at: number }
    | undefined;
  return row;
}
