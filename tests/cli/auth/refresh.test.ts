/**
 * Tests for `bounty auth refresh` command handler — ProfileContext integration.
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

async function callRefresh(args: Record<string, unknown> = {}): Promise<void> {
  const mod = await import('../../../src/cli/commands/auth/refresh.js');
  await mod.refreshCommand.handler!(args as never);
}

beforeEach(() => {
  tempDir = join(tmpdir(), `bounty-refresh-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  profilesDir = join(tempDir, 'profiles');
  configFile = join(tempDir, 'config.json');
  mkdirSync(profilesDir, { recursive: true });
  exitSpy = spyOn(process, 'exit').mockImplementation(((code: number) => {
    throw new Error(`__exit:${code}`);
  }) as never);
  errorSpy = spyOn(console, 'error').mockImplementation(() => {});
  logSpy = spyOn(console, 'log').mockImplementation(() => {});
  origFetch = globalThis.fetch;
  ProfileContext.clear();
});

afterEach(() => {
  globalThis.fetch = origFetch;
  rmSync(tempDir, { recursive: true, force: true });
  exitSpy.mockRestore();
  errorSpy.mockRestore();
  logSpy.mockRestore();
  ProfileContext.clear();
});

describe('bounty auth refresh handler', () => {
  test('rotates access_token via active profile.refresh_token + api_base', async () => {
    writeFileSync(
      join(profilesDir, 'prod.json'),
      JSON.stringify({
        name: 'prod',
        api_base: 'https://bounty.example.com',
        auth: {
          type: 'jwt',
          access_token: 'expired-jwt',
          refresh_token: 'refresh-old',
          expires_at: 1,
        },
        created_at: 1,
        updated_at: 1,
      }, null, 2),
    );
    ProfileContext.setActive({
      name: 'prod',
      api_base: 'https://bounty.example.com',
      auth: { type: 'jwt', access_token: 'expired-jwt', refresh_token: 'refresh-old', expires_at: 1 },
      created_at: 1,
      updated_at: 1,
    });

    let calledUrl: string | null = null;
    let calledBody: any = null;
    globalThis.fetch = mock(async (url: any, init?: any) => {
      calledUrl = String(url);
      calledBody = init?.body;
      return new Response(
        JSON.stringify({
          access_token: 'jwt-new',
          refresh_token: 'refresh-new',
          expires_in: 7200,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as any;

    await callRefresh({ __storeOptions: { profilesDir, configFile } });

    expect(calledUrl).toBe('https://bounty.example.com/api/auth/refresh');
    expect(JSON.parse(calledBody).refresh_token).toBe('refresh-old');

    const after = JSON.parse(readFileSync(join(profilesDir, 'prod.json'), 'utf8'));
    expect(after.auth.access_token).toBe('jwt-new');
    expect(after.auth.refresh_token).toBe('refresh-new');
    expect(after.auth.expires_at).toBeGreaterThan(0);
  });

  test('exits 1 when no active profile is set', async () => {
    await expect(callRefresh({ __storeOptions: { profilesDir, configFile } })).rejects.toThrow(
      /__exit:1/,
    );
  });

  test('exits 1 when active profile has no refresh_token', async () => {
    writeFileSync(
      join(profilesDir, 'plain.json'),
      JSON.stringify({
        name: 'plain',
        api_base: 'https://bounty.example.com',
        auth: { type: 'jwt', access_token: 'jwt-only' },
        created_at: 1,
        updated_at: 1,
      }, null, 2),
    );
    ProfileContext.setActive({
      name: 'plain',
      api_base: 'https://bounty.example.com',
      auth: { type: 'jwt', access_token: 'jwt-only' },
      created_at: 1,
      updated_at: 1,
    });
    await expect(callRefresh({ __storeOptions: { profilesDir, configFile } })).rejects.toThrow(
      /__exit:1/,
    );
  });
});