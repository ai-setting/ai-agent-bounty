#!/usr/bin/env node
/**
 * Platform detection and binary runner for @ai-setting/agent-bounty-standalone
 */

import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Platform mapping - map current platform to binary name
const binaryMap = {
  'linux-x64': 'bounty-linux-x64',
  'linux-arm64': 'bounty-linux-arm64',
  'darwin-x64': 'bounty-darwin-x64',
  'darwin-arm64': 'bounty-darwin-arm64',
  'win32-x64': 'bounty-windows-x64.exe',
};

const key = `${process.platform}-${process.arch}`;
let binary = binaryMap[key];

// Fallback: if platform-specific binary not found, try any available binary
if (!binary || !existsSync(resolve(__dirname, binary))) {
  // Try to find any available binary
  const candidates = [
    'bounty-linux-x64',
    'bounty',
    'bounty-darwin-x64',
    'bounty-darwin-arm64',
  ];
  for (const candidate of candidates) {
    const candidatePath = resolve(__dirname, candidate);
    if (existsSync(candidatePath)) {
      binary = candidate;
      break;
    }
  }
}

if (!binary || !existsSync(resolve(__dirname, binary))) {
  console.error(`❌ Unsupported platform: ${key}`);
  console.error('No binary found for this platform.');
  process.exit(1);
}

const binaryPath = resolve(__dirname, binary);
const args = process.argv.slice(2);

try {
  execFileSync(binaryPath, args, {
    stdio: 'inherit',
    cwd: process.cwd(),
  });
} catch (error) {
  process.exit(error.status || 1);
}