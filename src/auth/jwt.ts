/**
 * JWT Utilities for Bounty Platform
 * 
 * This module provides JWT token creation and verification using the jose library.
 */

import { SignJWT, jwtVerify } from 'jose';
import type { AuthTokenPayload } from './types.js';

/**
 * Get the JWT secret from environment variable
 * @throws Error if JWT_SECRET is not set
 */
const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return new TextEncoder().encode(secret);
};

/**
 * Create a JWT token with the given payload
 * Uses HS256 algorithm and sets expiration to 24 hours
 * 
 * @param payload - Token payload (sub: agent_id, email)
 * @returns JWT token string
 */
export async function createToken(payload: Omit<AuthTokenPayload, 'iat' | 'exp'>): Promise<string> {
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
