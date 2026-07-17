/**
 * Tests for `bounty auth login` command handler — ProfileContext integration.
 */

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
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
let origFetch: typeof fetch;
let origBountyToken: string | undefined;

function writeProfile(profile: Record<string, unknown>): void {
  writeFileSync(join(profilesDir, `${profile.name}.json`), JSON.stringify(profile, null, 2));
}

async function callLogin(args: Record<string, unknown>): Promise<void> {
  const mod = await import('../../../src/cli/commands/auth/login.js');
  await mod.loginCommand.handler!(args as never);
}

beforeEach(() => {
  tempDir = join(tmpdir(), `bounty-login-handler-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  profilesDir = join(tempDir, 'profiles');
  configFile = join(tempDir, 'config.json');
  mkdirSync(profilesDir, { recursive: true });
  exitSpy = spyOn(process, 'exit').mockImplementation(((code: number) => {
    throw new Error(`__exit:${code}`);
  }) as never);
  errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  logSpy = spyOn(console, 'log').mockImplementation(() => {});
  origFetch = globalThis.fetch;
  origBountyToken = process.env.BOUNTY_TOKEN;
  delete process.env.BOUNTY_TOKEN;
  ProfileContext.clear();
});

afterEach(() => {
  globalThis.fetch = origFetch;
  if (origBountyToken === undefined) {
    delete process.env.BOUNTY_TOKEN;
  } else {
    process.env.BOUNTY_TOKEN = origBountyToken;
  }
  rmSync(tempDir, { recursive: true, force: true });
  exitSpy.mockRestore();
  errorSpy.mockRestore();
  logSpy.mockRestore();
  ProfileContext.clear();
});

describe('bounty auth login handler', () => {
  test('posts to active profile.api_base and writes access_token back', async () => {
    writeProfile({
      name: 'prod',
      api_base: 'https://bounty.example.com',
      auth: { type: 'jwt' },
      created_at: 1,
      updated_at: 1,
    });
    ProfileContext.setActive({
      name: 'prod',
      api_base: 'https://bounty.example.com',
      auth: { type: 'jwt' },
      created_at: 1,
      updated_at: 1,
    });

    let calledUrl: string | null = null;
    globalThis.fetch = mock(async (url: any) => {
      calledUrl = String(url);
      return new Response(
        JSON.stringify({
          access_token: 'jwt-prod',
          refresh_token: 'refresh-prod',
          expires_in: 3600,
          agent_id: '11111111-2222-3333-4444-555555555555',
          email: 'prod@example.com',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    await callLogin({ email: 'prod@example.com', __storeOptions: { profilesDir, configFile } });

    expect(calledUrl).toBe('https://bounty.example.com/api/auth/login');
    const saved = JSON.parse(readFileSync(join(profilesDir, 'prod.json'), 'utf8'));
    expect(saved.auth.access_token).toBe('jwt-prod');
    expect(saved.auth.refresh_token).toBe('refresh-prod');
    expect(saved.auth.expires_at).toBeGreaterThan(0);
    expect(saved.agent_id).toBe('11111111-2222-3333-4444-555555555555');
    expect(saved.email).toBe('prod@example.com');
  });

  test('falls back to API_BASE when no profile is active (no profile writes)', async () => {
    let calledUrl: string | null = null;
    globalThis.fetch = mock(async (url: any) => {
      calledUrl = String(url);
      return new Response(
        JSON.stringify({
          token: 'jwt-no-profile',
          agent_id: '22222222-3333-4444-5555-666666666666',
          email: 'orphan@example.com',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    await callLogin({ email: 'orphan@example.com', __storeOptions: { profilesDir, configFile } });

    expect(calledUrl?.endsWith('/api/auth/login')).toBe(true);
  });
});