/**
 * Token Storage
 * Save and load auth tokens from filesystem
 */

import os from 'os';
import { join } from 'path';
import { mkdir, writeFile, readFile, rm } from 'fs/promises';

const TOKEN_FILE = join(os.homedir(), '.config', 'bounty', 'token');

export async function saveToken(token: string): Promise<void> {
  const dir = join(os.homedir(), '.config', 'bounty');
  await mkdir(dir, { recursive: true });
  await writeFile(TOKEN_FILE, token, 'utf-8');
}

export async function loadToken(): Promise<string | null> {
  try {
    return await readFile(TOKEN_FILE, 'utf-8');
  } catch {
    return null;
  }
}

export async function clearToken(): Promise<void> {
  try {
    await rm(TOKEN_FILE);
  } catch {
    // Ignore if file doesn't exist
  }
}

/**
 * Get token (alias for loadToken for API compatibility)
 */
export async function getToken(): Promise<string | null> {
  return loadToken();
}

interface TokenData {
  sub?: string;
  email?: string;
  iat?: number;
  exp?: number;
}

/**
 * Parse JWT token without verification (for display purposes only)
 * Returns the payload data
 */
export function getTokenData(token: string): TokenData | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}
