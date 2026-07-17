import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('ProfileManager (file IO)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `bounty-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  const profile = (name = 'alice') => ({
    name,
    api_base: `https://${name}.example.com`,
    auth: { type: 'jwt' as const },
    created_at: 1700000000,
    updated_at: 1700000000,
  });

  test('listProfiles returns empty array when profiles dir does not exist', async () => {
    const { listProfiles } = await import('../../../src/cli/config/store.js');
    expect(listProfiles({ profilesDir: join(tempDir, 'profiles') })).toEqual([]);
  });

  test('listProfiles returns sorted profile names and ignores non-json files', async () => {
    const profilesDir = join(tempDir, 'profiles');
    mkdirSync(profilesDir, { recursive: true });
    for (const name of ['bob', 'default', 'alice']) writeFileSync(join(profilesDir, `${name}.json`), '{}');
    writeFileSync(join(profilesDir, 'README.md'), '# readme');
    const { listProfiles } = await import('../../../src/cli/config/store.js');
    expect(listProfiles({ profilesDir })).toEqual(['alice', 'bob', 'default']);
  });

  test('loadProfile returns null when profile file missing', async () => {
    const { loadProfile } = await import('../../../src/cli/config/store.js');
    expect(loadProfile('alice', { profilesDir: join(tempDir, 'profiles') })).toBeNull();
  });

  test('loadProfile returns parsed valid profile', async () => {
    const profilesDir = join(tempDir, 'profiles');
    mkdirSync(profilesDir, { recursive: true });
    writeFileSync(join(profilesDir, 'alice.json'), JSON.stringify(profile()));
    const { loadProfile } = await import('../../../src/cli/config/store.js');
    expect(loadProfile('alice', { profilesDir })?.api_base).toBe('https://alice.example.com');
  });

  test('loadProfile returns null when JSON fails schema', async () => {
    const profilesDir = join(tempDir, 'profiles');
    mkdirSync(profilesDir, { recursive: true });
    writeFileSync(join(profilesDir, 'bad.json'), JSON.stringify({ name: 'Bad Name' }));
    const { loadProfile } = await import('../../../src/cli/config/store.js');
    expect(loadProfile('bad', { profilesDir })).toBeNull();
  });

  test('saveProfile creates profile file atomically', async () => {
    const profilesDir = join(tempDir, 'profiles');
    const { saveProfile } = await import('../../../src/cli/config/store.js');
    saveProfile(profile(), { profilesDir });
    const file = join(profilesDir, 'alice.json');
    expect(existsSync(file)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8')).name).toBe('alice');
    expect(readdirSync(profilesDir).filter((name) => name.includes('.tmp-'))).toEqual([]);
  });

  test('saveProfile overwrites existing profile', async () => {
    const profilesDir = join(tempDir, 'profiles');
    const { saveProfile } = await import('../../../src/cli/config/store.js');
    saveProfile(profile(), { profilesDir });
    saveProfile({ ...profile(), api_base: 'https://new.example.com', updated_at: 1700000001 }, { profilesDir });
    expect(JSON.parse(readFileSync(join(profilesDir, 'alice.json'), 'utf8')).api_base).toBe('https://new.example.com');
  });

  test('saveProfile validates schema before writing', async () => {
    const profilesDir = join(tempDir, 'profiles');
    const { saveProfile } = await import('../../../src/cli/config/store.js');
    expect(() => saveProfile({ ...profile(), name: 'Invalid Name' } as any, { profilesDir })).toThrow(/Invalid profile/);
    expect(existsSync(join(profilesDir, 'Invalid Name.json'))).toBe(false);
  });

  test('deleteProfile removes file', async () => {
    const profilesDir = join(tempDir, 'profiles');
    mkdirSync(profilesDir, { recursive: true });
    writeFileSync(join(profilesDir, 'alice.json'), '{}');
    const { deleteProfile } = await import('../../../src/cli/config/store.js');
    deleteProfile('alice', { profilesDir });
    expect(existsSync(join(profilesDir, 'alice.json'))).toBe(false);
  });

  test('deleteProfile is silent when profile missing', async () => {
    const { deleteProfile } = await import('../../../src/cli/config/store.js');
    expect(() => deleteProfile('ghost', { profilesDir: join(tempDir, 'profiles') })).not.toThrow();
  });

  test('readGlobalConfig returns null when config missing', async () => {
    const { readGlobalConfig } = await import('../../../src/cli/config/store.js');
    expect(readGlobalConfig({ configFile: join(tempDir, 'config.json') })).toBeNull();
  });

  test('writeGlobalConfig and readGlobalConfig roundtrip', async () => {
    const configFile = join(tempDir, 'config.json');
    const config = { version: 1 as const, active_profile: 'alice', schema_version: '0.11.0' };
    const { writeGlobalConfig, readGlobalConfig } = await import('../../../src/cli/config/store.js');
    writeGlobalConfig(config, { configFile });
    expect(readGlobalConfig({ configFile })).toEqual(config);
  });

  test('writeGlobalConfig rejects invalid config', async () => {
    const { writeGlobalConfig } = await import('../../../src/cli/config/store.js');
    expect(() => writeGlobalConfig({ version: 2, active_profile: 'alice', schema_version: '0.11.0' } as any, { configFile: join(tempDir, 'config.json') })).toThrow(/Invalid global config/);
  });

  test('updateLastUsed updates timestamp and file', async () => {
    const profilesDir = join(tempDir, 'profiles');
    const { saveProfile, updateLastUsed } = await import('../../../src/cli/config/store.js');
    saveProfile(profile(), { profilesDir });
    const before = Math.floor(Date.now() / 1000);
    updateLastUsed('alice', { profilesDir });
    const loaded = JSON.parse(readFileSync(join(profilesDir, 'alice.json'), 'utf8'));
    expect(loaded.last_used_at).toBeGreaterThanOrEqual(before);
    expect(loaded.updated_at).toBe(loaded.last_used_at);
  });

  test('updateLastUsed is silent when profile missing', async () => {
    const { updateLastUsed } = await import('../../../src/cli/config/store.js');
    expect(() => updateLastUsed('ghost', { profilesDir: join(tempDir, 'profiles') })).not.toThrow();
  });
});
