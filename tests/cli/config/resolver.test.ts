import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ProfileResolver priority chain', () => {
  let tempDir: string;
  let profilesDir: string;
  let configFile: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = join(tmpdir(), `bounty-resolver-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    profilesDir = join(tempDir, 'profiles');
    configFile = join(tempDir, 'config.json');
    mkdirSync(profilesDir, { recursive: true });
    originalEnv = process.env.BOUNTY_PROFILE;
    delete process.env.BOUNTY_PROFILE;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.BOUNTY_PROFILE;
    else process.env.BOUNTY_PROFILE = originalEnv;
  });

  function writeProfile(name: string): void {
    writeFileSync(join(profilesDir, `${name}.json`), JSON.stringify({
      name,
      api_base: `https://${name}.example.com`,
      auth: { type: 'jwt' },
      created_at: 1700000000,
      updated_at: 1700000000,
    }));
  }

  function writeConfig(active_profile: string): void {
    writeFileSync(configFile, JSON.stringify({ version: 1, active_profile, schema_version: '0.11.0' }));
  }

  test('CLI flag wins over env, config, and default', async () => {
    writeProfile('alice'); writeProfile('bob'); writeProfile('default'); writeConfig('bob');
    process.env.BOUNTY_PROFILE = 'default';
    const { resolveActiveProfile } = await import('../../../src/cli/config/resolver.js');
    const resolved = resolveActiveProfile('alice', { profilesDir, configFile });
    expect(resolved).toMatchObject({ name: 'alice', source: 'cli', exists: true });
    expect(resolved.profile?.api_base).toBe('https://alice.example.com');
  });

  test('BOUNTY_PROFILE env is used when CLI flag absent', async () => {
    writeProfile('bob'); writeProfile('default'); writeConfig('default'); process.env.BOUNTY_PROFILE = 'bob';
    const { resolveActiveProfile } = await import('../../../src/cli/config/resolver.js');
    expect(resolveActiveProfile(null, { profilesDir, configFile })).toMatchObject({ name: 'bob', source: 'env' });
  });

  test('config active_profile is used when CLI and env absent', async () => {
    writeProfile('bob'); writeConfig('bob');
    const { resolveActiveProfile } = await import('../../../src/cli/config/resolver.js');
    expect(resolveActiveProfile(null, { profilesDir, configFile })).toMatchObject({ name: 'bob', source: 'config' });
  });

  test('falls back to default when nothing else is specified', async () => {
    writeProfile('default');
    const { resolveActiveProfile } = await import('../../../src/cli/config/resolver.js');
    expect(resolveActiveProfile(null, { profilesDir, configFile })).toMatchObject({ name: 'default', source: 'default', exists: true });
  });

  test('explicit CLI missing profile returns exists false and available names', async () => {
    writeProfile('alice'); writeProfile('bob');
    const { resolveActiveProfile } = await import('../../../src/cli/config/resolver.js');
    expect(resolveActiveProfile('ghost', { profilesDir, configFile })).toMatchObject({
      name: 'ghost', source: 'cli', exists: false, profile: null, available: ['alice', 'bob'],
    });
  });

  test('missing default returns exists false and empty available names', async () => {
    const { resolveActiveProfile } = await import('../../../src/cli/config/resolver.js');
    expect(resolveActiveProfile(null, { profilesDir, configFile })).toMatchObject({
      name: 'default', source: 'default', exists: false, profile: null, available: [],
    });
  });
});
