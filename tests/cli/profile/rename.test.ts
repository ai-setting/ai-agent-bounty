import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('bounty profile rename', () => {
  let tempDir: string;
  let profilesDir: string;
  let configFile: string;
  let exitSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = join(tmpdir(), `bounty-rename-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  async function callRename(args: Record<string, unknown>) {
    const mod = await import('../../../src/cli/commands/profile/rename.js');
    await mod.renameCommand.handler!(args as never);
  }

  function writeProfile(name: string, overrides: Record<string, unknown> = {}): void {
    const profile = {
      name,
      api_base: `https://${name}.example.com`,
      auth: { type: 'jwt', access_token: `${name}-token` },
      created_at: 1690000000,
      updated_at: 1700000000,
      last_used_at: 1700000000,
      ...overrides,
    };
    writeFileSync(join(profilesDir, `${name}.json`), JSON.stringify(profile, null, 2));
  }

  test('renames a profile file and updates its name field', async () => {
    writeProfile('alice');
    await callRename({
      old: 'alice',
      new: 'alice2',
      __storeOptions: { profilesDir, configFile },
    });
    expect(existsSync(join(profilesDir, 'alice.json'))).toBe(false);
    expect(existsSync(join(profilesDir, 'alice2.json'))).toBe(true);
    const data = JSON.parse(readFileSync(join(profilesDir, 'alice2.json'), 'utf8'));
    expect(data.name).toBe('alice2');
    expect(data.api_base).toBe('https://alice.example.com'); // preserved
    expect(data.auth.access_token).toBe('alice-token'); // preserved
    const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('alice');
    expect(out).toContain('alice2');
  });

  test('synchronizes config.active_profile when renaming the active profile', async () => {
    writeProfile('alice');
    writeFileSync(configFile, JSON.stringify({
      version: 1,
      active_profile: 'alice',
      schema_version: '0.11.0',
    }));
    await callRename({
      old: 'alice',
      new: 'alice-renamed',
      __storeOptions: { profilesDir, configFile },
    });
    const cfg = JSON.parse(readFileSync(configFile, 'utf8'));
    expect(cfg.active_profile).toBe('alice-renamed');
    expect(cfg.schema_version).toBe('0.11.0');
  });

  test('does not touch config when renamed profile is not active', async () => {
    writeProfile('alice');
    writeProfile('bob');
    writeFileSync(configFile, JSON.stringify({
      version: 1,
      active_profile: 'bob',
      schema_version: '0.11.0',
    }));
    await callRename({
      old: 'alice',
      new: 'alice-renamed',
      __storeOptions: { profilesDir, configFile },
    });
    const cfg = JSON.parse(readFileSync(configFile, 'utf8'));
    expect(cfg.active_profile).toBe('bob');
  });

  test('rejects when new name already exists', async () => {
    writeProfile('alice');
    writeProfile('bob');
    await expect(
      callRename({
        old: 'alice',
        new: 'bob',
        __storeOptions: { profilesDir, configFile },
      }),
    ).rejects.toThrow(/__exit:1/);
    const errs = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errs).toContain('bob');
    // Both files should still exist
    expect(existsSync(join(profilesDir, 'alice.json'))).toBe(true);
    expect(existsSync(join(profilesDir, 'bob.json'))).toBe(true);
  });

  test('rejects when old profile does not exist', async () => {
    await expect(
      callRename({
        old: 'ghost',
        new: 'fresh',
        __storeOptions: { profilesDir, configFile },
      }),
    ).rejects.toThrow(/__exit:1/);
    const errs = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errs).toContain('ghost');
  });

  test('rejects malformed old name', async () => {
    await expect(
      callRename({
        old: 'NOT VALID',
        new: 'okay',
        __storeOptions: { profilesDir, configFile },
      }),
    ).rejects.toThrow(/__exit/);
  });

  test('rejects malformed new name', async () => {
    writeProfile('alice');
    await expect(
      callRename({
        old: 'alice',
        new: 'NOT VALID',
        __storeOptions: { profilesDir, configFile },
      }),
    ).rejects.toThrow(/__exit/);
    expect(existsSync(join(profilesDir, 'alice.json'))).toBe(true);
  });

  test('refuses when old or new argument is missing', async () => {
    writeProfile('alice');
    await expect(
      callRename({
        new: 'fresh',
        __storeOptions: { profilesDir, configFile },
      }),
    ).rejects.toThrow(/__exit/);
    await expect(
      callRename({
        old: 'alice',
        __storeOptions: { profilesDir, configFile },
      }),
    ).rejects.toThrow(/__exit/);
  });

  test('does not corrupt config when renaming a profile with no config file', async () => {
    writeProfile('alice');
    await callRename({
      old: 'alice',
      new: 'alice-renamed',
      __storeOptions: { profilesDir, configFile },
    });
    // No config file should be created
    expect(existsSync(configFile)).toBe(false);
    expect(existsSync(join(profilesDir, 'alice-renamed.json'))).toBe(true);
  });

  test('surfaces IO failure when old-file deletion fails (no swallow)', async () => {
    writeProfile('source');
    writeFileSync(configFile, JSON.stringify({
      version: 1,
      active_profile: 'default',
      schema_version: '0.11.0',
    }));

    // Patch fs.unlinkSync so the old-file removal fails with EACCES,
    // mimicking the PR1-store swallow that the verifier flagged. The new
    // rename.ts uses unlinkSync directly and must propagate non-ENOENT
    // errors as a user-visible exit(1).
    const fs = await import('fs');
    const realUnlink = fs.unlinkSync;
    const unlinkSpy = spyOn(fs, 'unlinkSync').mockImplementation(((
      target: Parameters<typeof realUnlink>[0],
    ) => {
      if (typeof target === 'string' && target.endsWith('source.json')) {
        const err: NodeJS.ErrnoException = new Error(`EACCES: permission denied, unlink '${target}'`);
        err.code = 'EACCES';
        throw err;
      }
      // Otherwise fall through to real unlinkSync (e.g. tmp cleanup).
      return realUnlink(target);
    }) as typeof fs.unlinkSync);

    try {
      await expect(
        callRename({
          old: 'source',
          new: 'target',
          __storeOptions: { profilesDir, configFile },
        }),
      ).rejects.toThrow(/__exit:1/);

      // New file is durable (saveProfile uses atomic tmp+rename); old file
      // remains because unlinkSync failed and we surfaced the error.
      expect(existsSync(join(profilesDir, 'target.json'))).toBe(true);
      expect(existsSync(join(profilesDir, 'source.json'))).toBe(true);
      const errs = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(errs.toLowerCase()).toMatch(/eacces|permission/);
    } finally {
      unlinkSpy.mockRestore();
    }
  });

  test('rejects rename when destination is a corrupted file on disk (defect 4)', async () => {
    // Alice is a valid profile; bob.json exists but holds non-JSON garbage,
    // so loadProfile(bob) returns null. The rename must still refuse
    // because the destination file physically exists on disk.
    writeProfile('alice');
    writeFileSync(join(profilesDir, 'bob.json'), 'this is not json {{{');

    await expect(
      callRename({
        old: 'alice',
        new: 'bob',
        __storeOptions: { profilesDir, configFile },
      }),
    ).rejects.toThrow(/__exit:1/);

    const errs = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errs).toContain('bob');
    expect(errs.toLowerCase()).toMatch(/already exists/);
    // Both files preserved: alice unchanged, bob still corrupted.
    expect(existsSync(join(profilesDir, 'alice.json'))).toBe(true);
    expect(existsSync(join(profilesDir, 'bob.json'))).toBe(true);
    expect(readFileSync(join(profilesDir, 'bob.json'), 'utf8')).toBe('this is not json {{{');
  });
});
