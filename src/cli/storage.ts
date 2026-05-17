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
