/**
 * Tests for `resolveCurrentAgent()` — DEPRECATED in v0.14 (Q5 ✅ DELETE).
 *
 * v0.14 BREAKING:
 *   - `BOUNTY_IM_ADDRESS` env var is REMOVED.
 *   - `resolveCurrentAgent` is DEPRECATED and unconditionally returns
 *     `undefined`. Active identity now flows exclusively through
 *     `ProfileContext.active.email` + `requireEmailFlag`.
 *
 * These tests assert the v0.14 contract: the helper is a no-op shim.
 * Real identity resolution lives in `src/cli/lib/email-flag.ts`.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

describe('resolveCurrentAgent (v0.14 deprecated shim, Q5 ✅ DELETE)', () => {
  let origImAddress: string | undefined;

  beforeEach(() => {
    origImAddress = process.env.BOUNTY_IM_ADDRESS;
    delete process.env.BOUNTY_IM_ADDRESS;
  });

  afterEach(() => {
    if (origImAddress === undefined) {
      delete process.env.BOUNTY_IM_ADDRESS;
    } else {
      process.env.BOUNTY_IM_ADDRESS = origImAddress;
    }
  });

  test('exports resolveCurrentAgent function', async () => {
    const mod = await import('../../src/cli/lib/current-agent.js');
    expect(typeof mod.resolveCurrentAgent).toBe('function');
  });

  test('v0.14: returns undefined unconditionally (BOUNTY_IM_ADDRESS is REMOVED)', async () => {
    const { resolveCurrentAgent } = await import('../../src/cli/lib/current-agent.js');
    expect(resolveCurrentAgent()).toBeUndefined();
  });

  test('v0.14: ignores BOUNTY_IM_ADDRESS even when valid <uuid>@<host>', async () => {
    process.env.BOUNTY_IM_ADDRESS = '8de9b6aa-5781-4a65-be96-45185fb7c8b1@bounty.example.com';

    const { resolveCurrentAgent } = await import('../../src/cli/lib/current-agent.js');
    // v0.14: BOUNTY_IM_ADDRESS REMOVED — the value is no longer read.
    expect(resolveCurrentAgent()).toBeUndefined();
  });

  test('v0.14: ignores BOUNTY_IM_ADDRESS even with bare UUID', async () => {
    process.env.BOUNTY_IM_ADDRESS = '8de9b6aa-5781-4a65-be96-45185fb7c8b1';

    const { resolveCurrentAgent } = await import('../../src/cli/lib/current-agent.js');
    expect(resolveCurrentAgent()).toBeUndefined();
  });

  test('v0.14: resolveCurrentAgentAddress returns undefined unconditionally', async () => {
    process.env.BOUNTY_IM_ADDRESS = '8de9b6aa-5781-4a65-be96-45185fb7c8b1@bounty.example.com';

    const { resolveCurrentAgentAddress } = await import('../../src/cli/lib/current-agent.js');
    expect(resolveCurrentAgentAddress()).toBeUndefined();
  });

  test('v0.14: identity resolution goes through ProfileContext + requireEmailFlag', async () => {
    // Sanity assertion: when active profile has an email, the v0.14 helper
    // (via ProfileContext.getActive) returns it. This is the new v0.14
    // contract — register-agent/login writes ProfileContext.active.email.
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    const { resolveActiveProfileEmail } = await import('../../src/cli/lib/email-flag.js');

    const minimalProfile = {
      name: 'demo',
      api_base: 'http://localhost:4000',
      auth: { type: 'jwt' as const, access_token: 'tok', refresh_token: null, expires_at: 0 },
      email: 'alice@example.com',
      created_at: 0,
      updated_at: 0,
    };
    ProfileContext.setActive(minimalProfile as any);
    try {
      expect(resolveActiveProfileEmail()).toBe('alice@example.com');
    } finally {
      ProfileContext.clear();
    }
  });
});
