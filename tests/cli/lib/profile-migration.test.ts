import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import { migrateLegacyToken } from '../../../src/cli/lib/profile-migration.js';

 describe('legacy token profile migration', () => {
  let root: string;
  let tokenPath: string;
  let profilesDir: string;
  let configFile: string;
  let logs: string[];

  beforeEach(() => {
    root = join(tmpdir(), `bounty-profile-migration-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tokenPath = join(root, 'token');
    profilesDir = join(root, 'profiles');
    configFile = join(root, 'config.json');
    mkdirSync(profilesDir, { recursive: true });
    logs = [];
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('copies a legacy token into the default profile and preserves the old file', () => {
    writeFileSync(tokenPath, ' legacy-jwt\n', 'utf8');

    const result = migrateLegacyToken({
      tokenPath,
      profilesDir,
      configFile,
      log: (message) => logs.push(message),
    });

    expect(result.migrated).toBe(true);
    expect(result.profileName).toBe('default');
    expect(JSON.parse(readFileSync(join(profilesDir, 'default.json'), 'utf8'))).toMatchObject({
      name: 'default',
      api_base: 'http://localhost:4000',
      auth: { type: 'jwt', access_token: 'legacy-jwt' },
    });
    expect(readFileSync(tokenPath, 'utf8')).toBe(' legacy-jwt\n');
    expect(logs.join('\n')).toMatch(/migrat/i);
  });

  test('does nothing when the legacy token is absent', () => {
    const result = migrateLegacyToken({ tokenPath, profilesDir, configFile, log: (message) => logs.push(message) });
    expect(result.migrated).toBe(false);
    expect(existsSync(join(profilesDir, 'default.json'))).toBe(false);
    expect(logs).toHaveLength(0);
  });

  test('does not replace an existing default profile token', () => {
    writeFileSync(tokenPath, 'legacy-jwt', 'utf8');
    writeFileSync(join(profilesDir, 'default.json'), JSON.stringify({
      name: 'default',
      api_base: 'https://profile.example.com',
      auth: { type: 'jwt', access_token: 'profile-jwt' },
      created_at: 1,
      updated_at: 1,
    }), 'utf8');

    const result = migrateLegacyToken({ tokenPath, profilesDir, configFile, log: (message) => logs.push(message) });
    expect(result.migrated).toBe(false);
    expect(JSON.parse(readFileSync(join(profilesDir, 'default.json'), 'utf8')).auth.access_token).toBe('profile-jwt');
    expect(logs.join('\n')).toMatch(/already|skip/i);
  });
});
