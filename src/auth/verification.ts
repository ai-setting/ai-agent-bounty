/**
 * Verification Code Logic for Bounty Platform
 * 
 * This module provides functions for generating and verifying email verification codes,
 * including rate limiting and code expiration handling.
 */

import { randomBytes } from 'crypto';
import type Database from 'better-sqlite3';

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
 * Generate a random 6-digit verification code
 * Uses cryptographically secure random bytes
 * 
 * @returns 6-digit string (e.g., "123456" or "001234")
 */
export function generateCode(): string {
  const buffer = randomBytes(3);  // 3 bytes = 24 bits = ~6 decimal digits
  const num = buffer.readUInt16BE(0) % 1000000;
  return num.toString().padStart(6, '0');
}

/**
 * Check if user is within rate limit for sending verification codes
 * Rate limit is 1 code per 60 seconds
 * 
 * @param db - Database instance
 * @param email - Email address to check
 * @returns RateLimitResult with allowed status and wait time if blocked
 */
export function checkRateLimit(db: Database.Database, email: string): RateLimitResult {
  const recent = db.prepare(`
    SELECT created_at FROM verifications 
    WHERE email = ? AND type = 'register'
    ORDER BY created_at DESC LIMIT 1
  `).get(email) as { created_at: number } | undefined;
  
  if (recent) {
    const elapsed = Math.floor(Date.now() / 1000) - Math.floor(recent.created_at / 1000);
    if (elapsed < RATE_LIMIT_SECONDS) {
      return {
        allowed: false,
        waitSeconds: RATE_LIMIT_SECONDS - elapsed
      };
    }
  }
  
  return { allowed: true };
}

/**
 * Create a new verification record in the database
 * 
 * @param db - Database instance
 * @param agentId - Agent ID associated with this verification
 * @param email - Email address for verification
 * @param code - 6-digit verification code
 */
export function createVerification(db: Database.Database, agentId: string, email: string, code: string): void {
  const id = generateUUID();
  const now = Date.now();
  const expiresAt = now + (CODE_EXPIRY_HOURS * 60 * 60 * 1000);
  
  db.prepare(`
    INSERT INTO verifications (id, agent_id, email, code, type, expires_at, created_at)
    VALUES (?, ?, ?, ?, 'register', ?, ?)
  `).run(id, agentId, email, code, expiresAt, now);
}

/**
 * Verify a verification code
 * Checks code validity, expiration, and marks as verified if valid
 * 
 * @param db - Database instance
 * @param email - Email address
 * @param code - Verification code to verify
 * @returns VerificationResult with validity status and agentId if valid
 */
export function verifyCode(db: Database.Database, email: string, code: string): VerificationResult {
  const record = db.prepare(`
    SELECT * FROM verifications 
    WHERE email = ? AND code = ? AND type = 'register' AND verified_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `).get(email, code) as {
    id: string;
    agent_id: string;
    email: string;
    code: string;
    type: string;
    expires_at: number;
    created_at: number;
    verified_at: number | null;
  } | undefined;
  
  if (!record) {
    return { valid: false, error: 'Invalid or expired verification code' };
  }
  
  const now = Date.now();
  if (now > record.expires_at) {
    return { valid: false, error: 'Verification code has expired' };
  }
  
  // Mark as verified
  db.prepare(`
    UPDATE verifications SET verified_at = ? WHERE id = ?
  `).run(now, record.id);
  
  return { valid: true, agentId: record.agent_id };
}

/**
 * Get the latest verification record for an email
 * 
 * @param db - Database instance
 * @param email - Email address
 * @returns Latest verification record or undefined
 */
export function getLatestVerification(db: Database.Database, email: string) {
  return db.prepare(`
    SELECT * FROM verifications 
    WHERE email = ? AND type = 'register'
    ORDER BY created_at DESC LIMIT 1
  `).get(email) as {
    id: string;
    agent_id: string;
    email: string;
    code: string;
    type: string;
    expires_at: number;
    created_at: number;
    verified_at: number | null;
  } | undefined;
}

/**
 * Generate a UUID v4 string
 * Used for generating unique IDs for verification records
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
