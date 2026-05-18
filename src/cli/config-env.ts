/**
 * Environment Configuration Loader
 * Loads environment variables from .env file and process.env
 */

import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';

// Load .env file if it exists
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  dotenvConfig({ path: envPath });
}

/**
 * Get environment variable with fallback
 */
export function getEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

/**
 * Get optional environment variable
 */
export function getOptionalEnv(key: string): string | undefined {
  return process.env[key];
}

// ============ CLI Configuration ============

/**
 * HTTP Server port
 */
export const CLI_SERVER_PORT = getEnv('BOUNTY_PORT', '4000');

/**
 * IM WebSocket Server port
 */
export const CLI_IM_PORT = getEnv('BOUNTY_IM_PORT', '4002');

/**
 * HTTP Server URL (for health checks)
 */
export const CLI_SERVER_URL = `http://localhost:${CLI_SERVER_PORT}`;

/**
 * IM WebSocket Server URL
 */
export const CLI_IM_SERVER_URL = getEnv('BOUNTY_IM_SERVER_URL', `ws://localhost:${CLI_IM_PORT}/ws`);

/**
 * API Base URL - used by all API commands
 */
export const CLI_API_BASE = getEnv('BOUNTY_API_URL', CLI_SERVER_URL);

/**
 * Bounty domain for agent addresses
 */
export const CLI_DOMAIN = getEnv('BOUNTY_DOMAIN', 'bounty.local');

/**
 * Database file path
 */
export const CLI_DB_PATH = getEnv('BOUNTY_DB_PATH', './data/bounty.db');

// ============ Config Items for Display ============

export interface ConfigItem {
  name: string;
  envKey: string;
  default: string;
  desc: string;
}

export const CONFIG_ITEMS: ConfigItem[] = [
  { name: 'BOUNTY_PORT', envKey: 'BOUNTY_PORT', default: '4000', desc: 'HTTP server port' },
  { name: 'BOUNTY_IM_PORT', envKey: 'BOUNTY_IM_PORT', default: '4002', desc: 'IM WebSocket server port' },
  { name: 'BOUNTY_API_URL', envKey: 'BOUNTY_API_URL', default: 'http://localhost:4000', desc: 'API base URL (CLI connects here)' },
  { name: 'BOUNTY_IM_SERVER_URL', envKey: 'BOUNTY_IM_SERVER_URL', default: 'ws://localhost:4002/ws', desc: 'IM WebSocket server URL' },
  { name: 'BOUNTY_DOMAIN', envKey: 'BOUNTY_DOMAIN', default: 'bounty.local', desc: 'Domain for agent addresses' },
  { name: 'BOUNTY_DB_PATH', envKey: 'BOUNTY_DB_PATH', default: './data/bounty.db', desc: 'Database file path' },
  { name: 'BOUNTY_IM_ADDRESS', envKey: 'BOUNTY_IM_ADDRESS', default: '(auto-set after register)', desc: 'Your IM address' },
  { name: 'SMTP_HOST', envKey: 'SMTP_HOST', default: '', desc: 'SMTP server host' },
  { name: 'SMTP_PORT', envKey: 'SMTP_PORT', default: '587', desc: 'SMTP server port' },
  { name: 'SMTP_USER', envKey: 'SMTP_USER', default: '', desc: 'SMTP username' },
  { name: 'JWT_SECRET', envKey: 'JWT_SECRET', default: '(auto-generated)', desc: 'JWT secret' },
];
