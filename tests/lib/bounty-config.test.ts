/**
 * BountyConfig must not produce side effects when imported (M1)
 *
 * Background: importing src/lib/config/bounty-config.ts ran
 * `loadEnv()` at module top level, which printed
 *   `[BountyConfig] Loaded .env from: ...`
 * to stdout. This made the module's behavior observable in
 * downstream consumers (e.g. test runners and CLI tools that
 * care about clean stdout). It also meant that the first import
 * of the module did I/O without the caller asking.
 *
 * New behavior: loadEnv() runs silently. The "loaded" indicator
 * is available through a public isEnvLoaded() helper for tests
 * and operators that want to verify the .env file was picked up.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

describe('BountyConfig quiet init (M1)', () => {
  let originalCwd: string;
  let originalBountyDomain: string | undefined;
  let tempDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    originalBountyDomain = process.env.BOUNTY_DOMAIN;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (originalBountyDomain === undefined) {
      delete process.env.BOUNTY_DOMAIN;
    } else {
      process.env.BOUNTY_DOMAIN = originalBountyDomain;
    }
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  });

  it('does not write to stdout when the module is imported', async () => {
    // Capture stdout while we import the module. Each test gets a
    // fresh module cache so the top-level loadEnv() actually runs.
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(a => String(a)).join(' '));
    };
    try {
      await import(`../../src/lib/config/bounty-config.ts?nocache=${Date.now()}-${Math.random()}`);
    } finally {
      console.log = original;
    }
    const noisy = lines.filter(l => l.includes('BountyConfig'));
    expect(noisy).toEqual([]);
  });

  it('still reads BOUNTY_DOMAIN from a .env file in the current working directory', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bounty-config-'));
    writeFileSync(
      join(tempDir, '.env'),
      'BOUNTY_DOMAIN=test-domain.local\n',
      'utf-8'
    );
    process.chdir(tempDir);
    delete process.env.BOUNTY_DOMAIN;

    const mod = await import(`../../src/lib/config/bounty-config.ts?nocache=${Date.now()}-${Math.random()}`);
    expect(mod.bountyConfig.domain).toBe('test-domain.local');
  });

  it('exposes an isEnvLoaded() helper so operators can verify .env was picked up', async () => {
    const mod = await import(`../../src/lib/config/bounty-config.ts?nocache=${Date.now()}-${Math.random()}`);
    expect(typeof mod.isEnvLoaded).toBe('function');
    // Re-importing should not change the answer: once the .env has
    // been read, isEnvLoaded() returns true regardless of cwd.
    expect(mod.isEnvLoaded()).toBe(true);
  });
});
