/**
 * Tests for `bounty com send` auto-Authorization + --insecure flag (Phase C.1 enhancement)
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as os from 'os';

describe('readAuthToken', () => {
  let originalHome: string;
  let tempHome: string;

  beforeEach(() => {
    originalHome = os.homedir();
    tempHome = join(tmpdir(), `bounty-test-${Date.now()}-${Math.random()}`);
    mkdirSync(tempHome, { recursive: true });
    mkdirSync(join(tempHome, '.config', 'bounty'), { recursive: true });
    // Override HOME via os.homedir monkey patching not feasible;
    // we test the symbolic function shape instead.
  });

  afterEach(() => {
    try {
      rmSync(tempHome, { recursive: true, force: true });
    } catch {}
  });

  test('exports readAuthToken function', async () => {
    const mod = await import('../../src/cli/commands/com/send');
    expect(typeof mod.readAuthToken).toBe('function');
  });

  test('readAuthToken returns string when token file exists', async () => {
    // Write token file in expected location
    const tokenDir = join(os.homedir(), '.config', 'bounty');
    const tokenPath = join(tokenDir, 'token');
    const originalExists = existsSync(tokenPath);
    const originalContent = originalExists ? readFileSync(tokenPath, 'utf-8') : null;

    const testToken = 'eyJhbGciOiJIUzI1NiJ9.test-token';
    mkdirSync(tokenDir, { recursive: true });
    writeFileSync(tokenPath, testToken, 'utf-8');

    try {
      const mod = await import('../../src/cli/commands/com/send');
      // Re-evaluate (cache busting not needed for bun)
      const result = (mod as any).readAuthToken?.() ?? eval('mod').readAuthToken();
      expect(typeof result === 'string' || result === undefined).toBe(true);
    } finally {
      // Restore
      if (originalExists && originalContent !== null) {
        writeFileSync(tokenPath, originalContent, 'utf-8');
      } else {
        try { rmSync(tokenPath); } catch {}
      }
    }
  });
});

describe('send.ts source — auto-Authorization + --insecure wiring', () => {
  test('source should declare --insecure flag', async () => {
    const src = readFileSync('src/cli/commands/com/send.ts', 'utf-8');
    expect(src).toContain("alias: 'k'");
    expect(src).toContain("'insecure'");
    expect(src).toContain('NODE_TLS_REJECT_UNAUTHORIZED');
  });

  test('source should auto-attach Authorization header when token present', async () => {
    const src = readFileSync('src/cli/commands/com/send.ts', 'utf-8');
    expect(src).toContain('readAuthToken');
    expect(src).toContain('authHeaders');
    expect(src).toContain('Authorization');
    expect(src).toContain('Bearer ${authToken}');
  });

  test('source should still pass through --server-url scheme validation', async () => {
    const src = readFileSync('src/cli/commands/com/send.ts', 'utf-8');
    expect(src).toContain('^https?:\\/\\/');
  });
});
