/**
 * JWT Utilities for Bounty Platform
 *
 * This module provides JWT token creation and verification using the jose library.
 */

import { SignJWT, jwtVerify } from 'jose';
import { hostname } from 'os';
import type { AuthTokenPayload } from './types.js';

const isProduction = () => process.env.NODE_ENV === 'production';

let warnedFallback = false;

/**
 * Get the JWT secret from environment variable.
 *
 * In development (no NODE_ENV=production), if JWT_SECRET is not set, a
 * stable derived secret is used (based on hostname + pid) and a warning
 * is logged once per process. This avoids hard crashes in dev/test
 * while still preferring an explicit value when present.
 *
 * In production, an unset JWT_SECRET is a hard error.
 *
 * @throws Error if JWT_SECRET is not set in production.
 */
const getSecret = (): Uint8Array => {
  const secret = process.env.JWT_SECRET;
  if (secret) {
    return new TextEncoder().encode(secret);
  }
  if (isProduction()) {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  if (!warnedFallback) {
    console.warn(
      '[JWT] JWT_SECRET not set — using a derived dev secret. ' +
        'Set JWT_SECRET for production use.'
    );
    warnedFallback = true;
  }
  const fallback = `bounty-dev-jwt-${hostname()}-${process.pid}`;
  return new TextEncoder().encode(fallback);
};

/**
 * Create a JWT token with the given payload
 * Uses HS256 algorithm and sets expiration to 24 hours
 *
 * @param payload - Token payload (sub: agent_id, email)
 * @returns JWT token string
 */
export async function createToken(payload: { sub: string; email?: string }): Promise<string> {
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(getSecret());

  return token;
}

/**
 * Verify and decode a JWT token
 *
 * @param token - JWT token string to verify
 * @returns Decoded token payload
 * @throws Error if token is invalid or expired
 */
export async function verifyToken(token: string): Promise<AuthTokenPayload> {
  const { payload } = await jwtVerify(token, getSecret());
  return payload as unknown as AuthTokenPayload;
}

/**
 * Get the token expiry time in seconds
 * @returns 24 hours in seconds (86400)
 */
export function getTokenExpiry(): number {
  return 24 * 60 * 60; // 24 hours in seconds
}
