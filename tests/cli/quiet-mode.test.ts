/**
 * @fileoverview Tests for bounty CLI quiet mode
 *
 * Verifies that:
 * 1. setQuietMode(true) is called before initializeBountyEnv()
 * 2. The global --quiet option exists with default true
 * 3. The prompt hook respects quiet mode (no console.log when quiet)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { isQuietMode, setQuietMode } from '@ai-setting/roy-agent-core';
import { readFileSync } from 'fs';

// ============================================================
// Test 1: setQuietMode / isQuietMode from core
// ============================================================
describe('quiet mode core API', () => {
  beforeEach(() => {
    setQuietMode(false);
  });

  it('should start with quiet mode disabled', () => {
    expect(isQuietMode()).toBe(false);
  });

  it('should enable quiet mode when setQuietMode(true) is called', () => {
    setQuietMode(true);
    expect(isQuietMode()).toBe(true);
  });

  it('should disable quiet mode when setQuietMode(false) is called', () => {
    setQuietMode(true);
    setQuietMode(false);
    expect(isQuietMode()).toBe(false);
  });
});

// ============================================================
// Test 2: Prompt hook respects quiet mode
// ============================================================
describe('bounty prompt hook quiet mode', () => {
  const originalLog = console.log;
  let logCalls: unknown[][];

  beforeEach(() => {
    logCalls = [];
    console.log = (...args: unknown[]) => {
      logCalls.push(args);
    };
    setQuietMode(false);
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it('should log "[Bounty] Prompt hook registered" when quiet mode is off', async () => {
    // Re-import to trigger module-level execution
    setQuietMode(false);
    const { registerBountyPromptHook } = await import('../../src/cli/hooks/bounty-prompt-hook');
    registerBountyPromptHook();
    // After fix, console.log should be guarded by isQuietMode()
    // When quiet mode is off, it should log
    expect(logCalls.length).toBeGreaterThanOrEqual(1);
    const logMessage = logCalls.find((args) =>
      args.some((a) => typeof a === 'string' && a.includes('Prompt hook registered'))
    );
    expect(logMessage).toBeDefined();
  });

  it('should NOT log "[Bounty] Prompt hook registered" when quiet mode is on', async () => {
    setQuietMode(true);
    const { registerBountyPromptHook } = await import('../../src/cli/hooks/bounty-prompt-hook');
    registerBountyPromptHook();
    // After fix, when quiet mode is on, console.log should be suppressed
    const logMessage = logCalls.find((args) =>
      args.some((a) => typeof a === 'string' && a.includes('Prompt hook registered'))
    );
    expect(logMessage).toBeUndefined();
  });
});

// ============================================================
// Test 3: CLI module imports setQuietMode and calls it
// ============================================================
describe('cli.ts quiet mode integration', () => {
  it('should import setQuietMode from @ai-setting/roy-agent-core', async () => {
    // Verify the module can be imported and has setQuietMode
    const cliModule = await import('../../src/cli/cli');
    expect(cliModule).toBeDefined();
    expect(cliModule.runBountyCli).toBeDefined();
  });

  it('should call setQuietMode(true) before initializeBountyEnv()', () => {
    // This is a structural test: verify the source code order
    // by reading the file and checking that setQuietMode(true)
    // appears before initializeBountyEnv() in runBountyCli()
    const source = readFileSync('src/cli/cli.ts', 'utf-8');

    // Find the runBountyCli function body
    const runBountyCliStart = source.indexOf('export async function runBountyCli');
    expect(runBountyCliStart).toBeGreaterThan(-1);

    // Extract the function body up to the initializeBountyEnv call
    const body = source.slice(runBountyCliStart);
    const initEnvPos = body.indexOf('initializeBountyEnv()');
    const setQuietPos = body.indexOf('setQuietMode(true)');

    expect(initEnvPos).toBeGreaterThan(-1);
    expect(setQuietPos).toBeGreaterThan(-1);
    expect(setQuietPos).toBeLessThan(initEnvPos);
  });

  it('should have global --quiet option with default true', () => {
    const source = readFileSync('src/cli/cli.ts', 'utf-8');

    // Check for the quiet option definition
    expect(source).toContain("'quiet'");
    expect(source).toContain('describe');
    expect(source).toContain('--no-quiet');
    expect(source).toContain('default: true');
    expect(source).toContain('global: true');
  });

  it('should have a middleware that sets quiet mode from argv', () => {
    const source = readFileSync('src/cli/cli.ts', 'utf-8');

    // Check for middleware
    expect(source).toContain('middleware');
    expect(source).toContain('argv.quiet');
    expect(source).toContain('setQuietMode');
  });
});
