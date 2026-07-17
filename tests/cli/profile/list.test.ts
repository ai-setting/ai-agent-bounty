import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('bounty profile list', () => {
  let tempDir: string;
  let profilesDir: string;
  let configFile: string;
  let exitSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = join(tmpdir(), `bounty-list-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    profilesDir = join(tempDir, 'profiles');
    configFile = join(tempDir, 'config.json');
    mkdirSync(profilesDir, { recursive: true });
    exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__exit:${code ?? 'null'}`);
    }) as never);
    errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    logSpy = spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  async function callList(args: Record<string, unknown>) {
    const mod = await import('../../../src/cli/commands/profile/list.js');
    await mod.listCommand.handler!(args as never);
  }

  function writeProfile(name: string, overrides: Record<string, unknown> = {}): void {
    const profile = {
      name,
      api_base: `https://${name}.example.com`,
      agent_id: '11111111-2222-3333-4444-555555555555',
      auth: {
        type: 'jwt',
        access_token: `${name}-token`,
        refresh_token: `${name}-refresh`,
        scope: ['task:read', 'task:write'],
      },
      last_used_at: 1700000000,
      created_at: 1690000000,
      updated_at: 1700000000,
      ...overrides,
    };
    writeFileSync(join(profilesDir, `${name}.json`), JSON.stringify(profile, null, 2));
  }

  test('lists profiles in a human-readable table with active marker', async () => {
    writeProfile('alice');
    writeProfile('bob');
    writeFileSync(configFile, JSON.stringify({
      version: 1,
      active_profile: 'alice',
      schema_version: '0.11.0',
    }));
    await callList({
      __storeOptions: { profilesDir, configFile },
    });
    const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('alice');
    expect(out).toContain('bob');
    // Active marker should appear on alice line (and not on bob)
    const aliceLine = logSpy.mock.calls
      .map((c) => c.join(' '))
      .find((line) => line.includes('alice') && !line.includes('Available'));
    expect(aliceLine).toBeDefined();
    expect(aliceLine!).toMatch(/\*/);
    const bobLine = logSpy.mock.calls
      .map((c) => c.join(' '))
      .find((line) => line.includes('bob') && !line.includes('Available'));
    expect(bobLine).toBeDefined();
    expect(bobLine!).not.toMatch(/\*/);
  });

  test('--json outputs structured payload (no tokens)', async () => {
    writeProfile('alice');
    writeProfile('carol');
    writeFileSync(configFile, JSON.stringify({
      version: 1,
      active_profile: 'carol',
      schema_version: '0.11.0',
    }));
    let captured = '';
    logSpy.mockImplementation((...args: unknown[]) => {
      captured += args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    });

    await callList({
      json: true,
      __storeOptions: { profilesDir, configFile },
    });

    const parsed = JSON.parse(captured);
    expect(parsed.active).toBe('carol');
    expect(Array.isArray(parsed.profiles)).toBe(true);
    expect(parsed.profiles.length).toBe(2);
    const names = parsed.profiles.map((p: { name: string }) => p.name).sort();
    expect(names).toEqual(['alice', 'carol']);
    // JSON must not contain any token material
    expect(captured).not.toContain('alice-token');
    expect(captured).not.toContain('carol-token');
    expect(captured).not.toContain('refresh');
    for (const p of parsed.profiles) {
      expect(p).toHaveProperty('api_base');
      expect(p).toHaveProperty('agent_id');
      expect(p).toHaveProperty('scope_count');
      expect(p).toHaveProperty('last_used_at');
    }
  });

  test('empty directory succeeds with helpful message', async () => {
    await callList({
      __storeOptions: { profilesDir, configFile },
    });
    const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n') +
      '\n' + errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toMatch(/no profile|bounty profile add/i);
  });

  test('falls back to "default" active when config missing', async () => {
    writeProfile('default');
    await callList({
      json: true,
      __storeOptions: { profilesDir, configFile },
    });
    const out = logSpy.mock.calls.map((c) => c.join(' ')).join('');
    const parsed = JSON.parse(out);
    expect(parsed.active).toBe('default');
    const def = parsed.profiles.find((p: { name: string }) => p.name === 'default');
    expect(def).toBeDefined();
  });

  test('skips corrupted profile files (does not throw)', async () => {
    writeProfile('alice');
    writeFileSync(join(profilesDir, 'broken.json'), '{ not valid json');
    await callList({
      json: true,
      __storeOptions: { profilesDir, configFile },
    });
    const out = logSpy.mock.calls.map((c) => c.join(' ')).join('');
    const parsed = JSON.parse(out);
    const names = parsed.profiles.map((p: { name: string }) => p.name);
    expect(names).toContain('alice');
    expect(names).not.toContain('broken');
  });

  test('shows scope_count derived from auth.scope length', async () => {
    writeProfile('one-scope', {
      auth: { type: 'jwt', scope: ['task:read'] },
    });
    writeProfile('no-scope', {
      auth: { type: 'jwt' },
    });
    await callList({
      json: true,
      __storeOptions: { profilesDir, configFile },
    });
    const out = logSpy.mock.calls.map((c) => c.join(' ')).join('');
    const parsed = JSON.parse(out);
    const oneScope = parsed.profiles.find((p: { name: string }) => p.name === 'one-scope');
    const noScope = parsed.profiles.find((p: { name: string }) => p.name === 'no-scope');
    expect(oneScope.scope_count).toBe(1);
    expect(noScope.scope_count).toBe(0);
  });

  test('marks global --profile as active in --json (overrides config active)', async () => {
    writeProfile('alpha');
    writeProfile('beta');
    writeFileSync(configFile, JSON.stringify({
      version: 1,
      active_profile: 'alpha',
      schema_version: '0.11.0',
    }));
    let captured = '';
    logSpy.mockImplementation((...args: unknown[]) => {
      captured += args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    });
    await callList({
      json: true,
      profile: 'beta',
      __storeOptions: { profilesDir, configFile },
    });
    const parsed = JSON.parse(captured);
    expect(parsed.active).toBe('beta');
  });

  test('--json does not leak email field', async () => {
    writeProfile('alice', { email: 'alice@example.com' });
    writeProfile('bob', { email: 'bob@example.com' });
    writeFileSync(configFile, JSON.stringify({
      version: 1,
      active_profile: 'alice',
      schema_version: '0.11.0',
    }));
    let captured = '';
    logSpy.mockImplementation((...args: unknown[]) => {
      captured += args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    });
    await callList({
      json: true,
      __storeOptions: { profilesDir, configFile },
    });
    const parsed = JSON.parse(captured);
    for (const p of parsed.profiles) {
      expect(p).not.toHaveProperty('email');
    }
    expect(captured).not.toContain('alice@example.com');
    expect(captured).not.toContain('bob@example.com');
  });
});
