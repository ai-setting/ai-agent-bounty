import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('bounty profile remove', () => {
  let tempDir: string;
  let profilesDir: string;
  let configFile: string;
  let exitSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `bounty-remove-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  async function callRemove(args: Record<string, unknown>) {
    const mod = await import('../../../src/cli/commands/profile/remove.js');
    await mod.removeCommand.handler!(args as never);
  }

  function writeProfile(name: string): void {
    const profile = {
      name,
      api_base: `https://${name}.example.com`,
      auth: { type: 'jwt' },
      created_at: 1690000000,
      updated_at: 1700000000,
    };
    writeFileSync(join(profilesDir, `${name}.json`), JSON.stringify(profile, null, 2));
  }

  function writeConfig(activeProfile: string): void {
    writeFileSync(configFile, JSON.stringify({
      version: 1,
      active_profile: activeProfile,
      schema_version: '0.11.0',
    }));
  }

  test('--force removes an existing profile and skips confirm', async () => {
    writeProfile('alice');
    writeProfile('bob');
    writeConfig('bob');

    let confirmCalled = false;
    await callRemove({
      name: 'alice',
      force: true,
      __storeOptions: { profilesDir, configFile },
      __confirm: () => {
        confirmCalled = true;
        return Promise.resolve(true);
      },
    });

    expect(existsSync(join(profilesDir, 'alice.json'))).toBe(false);
    expect(existsSync(join(profilesDir, 'bob.json'))).toBe(true);
    expect(confirmCalled).toBe(false);
    const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('alice');
  });

  test('removes a profile when __confirm resolves true', async () => {
    writeProfile('alice');
    writeConfig('default');

    await callRemove({
      name: 'alice',
      __storeOptions: { profilesDir, configFile },
      __confirm: () => Promise.resolve(true),
    });

    expect(existsSync(join(profilesDir, 'alice.json'))).toBe(false);
  });

  test('aborts remove when __confirm resolves false (no-op)', async () => {
    writeProfile('alice');
    writeConfig('default');

    await callRemove({
      name: 'alice',
      __storeOptions: { profilesDir, configFile },
      __confirm: () => Promise.resolve(false),
    });

    // File still exists
    expect(existsSync(join(profilesDir, 'alice.json'))).toBe(true);
    // No exit thrown
    const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toMatch(/abort|cancel|not removed|skip/i);
  });

  test('refuses to remove the effective active profile', async () => {
    writeProfile('alice');
    writeConfig('alice'); // alice is active

    await expect(
      callRemove({
        name: 'alice',
        force: true,
        __storeOptions: { profilesDir, configFile },
        __confirm: () => Promise.resolve(true),
      }),
    ).rejects.toThrow(/__exit:1/);

    // File must NOT be deleted
    expect(existsSync(join(profilesDir, 'alice.json'))).toBe(true);
    const errs = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errs).toContain('alice');
    expect(errs.toLowerCase()).toMatch(/active|current/);
    expect(errs).toMatch(/profile use/);
  });

  test('refuses to remove a non-existent profile', async () => {
    writeProfile('alice');
    writeConfig('default');

    await expect(
      callRemove({
        name: 'ghost',
        force: true,
        __storeOptions: { profilesDir, configFile },
        __confirm: () => Promise.resolve(true),
      }),
    ).rejects.toThrow(/__exit:1/);

    const errs = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errs).toContain('ghost');
  });

  test('rejects malformed profile name', async () => {
    writeConfig('default');
    await expect(
      callRemove({
        name: 'NOT VALID',
        force: true,
        __storeOptions: { profilesDir, configFile },
        __confirm: () => Promise.resolve(true),
      }),
    ).rejects.toThrow(/__exit/);
  });

  test('does not pollute user HOME (writes only to __storeOptions path)', async () => {
    writeProfile('alice');
    writeConfig('default');
    // Just call with __storeOptions and ensure configFile exists only there
    await callRemove({
      name: 'alice',
      force: true,
      __storeOptions: { profilesDir, configFile },
    });
    expect(existsSync(join(profilesDir, 'alice.json'))).toBe(false);
    // configFile should not be modified beyond resolving the active check
    const cfgRaw = readFileSync(configFile, 'utf8');
    const cfg = JSON.parse(cfgRaw);
    expect(cfg.active_profile).toBe('default');
  });

  test('refuses to remove the profile named via global --profile override', async () => {
    writeProfile('alpha');
    writeProfile('beta');
    writeFileSync(configFile, JSON.stringify({
      version: 1,
      active_profile: 'alpha',
      schema_version: '0.11.0',
    }));
    await expect(
      callRemove({
        name: 'beta',
        force: true,
        profile: 'beta',
        __storeOptions: { profilesDir, configFile },
        __confirm: () => Promise.resolve(true),
      }),
    ).rejects.toThrow(/__exit:1/);
    expect(existsSync(join(profilesDir, 'beta.json'))).toBe(true);
  });
});
