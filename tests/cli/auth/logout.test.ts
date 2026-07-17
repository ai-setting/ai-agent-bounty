/**
 * Tests for `bounty auth logout` command handler — ProfileContext integration.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { ProfileContext } from '../../../src/cli/config/context.js';

let tempDir: string;
let profilesDir: string;
let configFile: string;
let exitSpy: ReturnType<typeof spyOn>;
let errorSpy: ReturnType<typeof spyOn>;
let logSpy: ReturnType<typeof spyOn>;

async function callLogout(args: Record<string, unknown> = {}): Promise<void> {
  const mod = await import('../../../src/cli/commands/auth/logout.js');
  await mod.logoutCommand.handler!(args as never);
}

beforeEach(() => {
  tempDir = join(tmpdir(), `bounty-logout-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  profilesDir = join(tempDir, 'profiles');
  configFile = join(tempDir, 'config.json');
  mkdirSync(profilesDir, { recursive: true });
  exitSpy = spyOn(process, 'exit').mockImplementation(((code: number) => {
    throw new Error(`__exit:${code}`);
  }) as never);
  errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  logSpy = spyOn(console, 'log').mockImplementation(() => {});
  ProfileContext.clear();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  exitSpy.mockRestore();
  errorSpy.mockRestore();
  logSpy.mockRestore();
  ProfileContext.clear();
});

describe('bounty auth logout handler', () => {
  test('clears access_token / refresh_token from active profile (preserves profile)', async () => {
    writeFileSync(
      join(profilesDir, 'prod.json'),
      JSON.stringify({
        name: 'prod',
        api_base: 'https://bounty.example.com',
        auth: {
          type: 'jwt',
          access_token: 'jwt-keep',
          refresh_token: 'refresh-keep',
          expires_at: 1_700_000_000,
        },
        agent_id: '11111111-2222-3333-4444-555555555555',
        email: 'prod@example.com',
        created_at: 1,
        updated_at: 1,
      }, null, 2),
    );
    ProfileContext.setActive({
      name: 'prod',
      api_base: 'https://bounty.example.com',
      auth: {
        type: 'jwt',
        access_token: 'jwt-keep',
        refresh_token: 'refresh-keep',
        expires_at: 1_700_000_000,
      },
      agent_id: '11111111-2222-3333-4444-555555555555',
      email: 'prod@example.com',
      created_at: 1,
      updated_at: 1,
    });

    await callLogout({ __storeOptions: { profilesDir, configFile } });

    const after = JSON.parse(readFileSync(join(profilesDir, 'prod.json'), 'utf8'));
    expect(after.name).toBe('prod');
    expect(after.api_base).toBe('https://bounty.example.com');
    expect(after.agent_id).toBe('11111111-2222-3333-4444-555555555555');
    expect(after.email).toBe('prod@example.com');
    expect(after.auth.access_token).toBeUndefined();
    expect(after.auth.refresh_token).toBeUndefined();
    expect(after.auth.expires_at).toBeUndefined();
  });

  test('succeeds when no active profile (no token file to clear)', async () => {
    await callLogout({ __storeOptions: { profilesDir, configFile } });
    const logs = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logs.toLowerCase()).toMatch(/logged out/);
  });
});