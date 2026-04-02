/**
 * Encryption utilities for sensitive data
 * Uses AES-256-GCM for password encryption
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 32;

/**
 * Get encryption key from environment or generate a default
 * In production, set BOUNTY_ENCRYPTION_KEY environment variable
 */
function getEncryptionKey(): Buffer {
  const envKey = process.env.BOUNTY_ENCRYPTION_KEY;
  if (envKey) {
    // Derive a 32-byte key from the environment key using scrypt
    return scryptSync(envKey, 'bounty-salt', 32);
  }
  // For development only - in production, use environment variable
  console.warn('[Crypto] Warning: Using default encryption key. Set BOUNTY_ENCRYPTION_KEY environment variable for security.');
  return scryptSync('bounty-default-dev-key-do-not-use-in-production', 'bounty-salt', 32);
}

/**
 * Encrypt a string
 * Returns base64 encoded string: salt:iv:encryptedData:tag
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) return '';

  const key = getEncryptionKey();
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);

  // Derive a unique key for this encryption using the salt
  const derivedKey = scryptSync(key, salt, 32);

  const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const tag = cipher.getAuthTag();

  // Combine: salt:iv:encrypted:tag (all base64)
  return `${salt.toString('base64')}:${iv.toString('base64')}:${encrypted}:${tag.toString('base64')}`;
}

/**
 * Decrypt an encrypted string
 * Expects format: salt:iv:encryptedData:tag (all base64)
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) return '';

  try {
    const parts = ciphertext.split(':');
    if (parts.length !== 4) {
      throw new Error('Invalid encrypted data format');
    }

    const [saltB64, ivB64, encryptedB64, tagB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const iv = Buffer.from(ivB64, 'base64');
    const encrypted = Buffer.from(encryptedB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');

    const key = getEncryptionKey();
    const derivedKey = scryptSync(key, salt, 32);

    const decipher = createDecipheriv(ALGORITHM, derivedKey, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  } catch (error: any) {
    console.error('[Crypto] Decryption failed:', error.message);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Hash a value (one-way, for comparison)
 */
export function hash(value: string): string {
  const key = getEncryptionKey();
  return scryptSync(value, key, 32).toString('base64');
}

/**
 * Check if a value matches a hash
 */
export function verifyHash(value: string, hashValue: string): boolean {
  return hash(value) === hashValue;
}
