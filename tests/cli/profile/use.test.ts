import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('bounty profile use', () => {
  let tempDir: string;
  let profilesDir: string;
  let configFile: string;
  let exitSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = join(tmpdir(), `bounty-use-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  async function callUse(args: Record<string, unknown>) {
    const mod = await import('../../../src/cli/commands/profile/use.js');
    await mod.useCommand.handler!(args as never);
  }

  function writeProfile(name: string): void {
    writeFileSync(join(profilesDir, `${name}.json`), JSON.stringify({
      name,
      api_base: `https://${name}.example.com`,
      auth: { type: 'jwt' },
      created_at: 1,
      updated_at: 1,
    }));
  }

  test('writes active_profile to config.json', async () => {
    writeProfile('alice');
    await callUse({
      name: 'alice',
      __storeOptions: { profilesDir, configFile },
    });
    const cfg = JSON.parse(readFileSync(configFile, 'utf8'));
    expect(cfg.version).toBe(1);
    expect(cfg.active_profile).toBe('alice');
    expect(typeof cfg.schema_version).toBe('string');
    expect(cfg.schema_version.length).toBeGreaterThan(0);
    const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('alice');
  });

  test('initializes config.json when missing (creates dir + file)', async () => {
    writeProfile('fresh');
    expect(existsSync(configFile)).toBe(false);
    await callUse({
      name: 'fresh',
      __storeOptions: { profilesDir, configFile },
    });
    expect(existsSync(configFile)).toBe(true);
    const cfg = JSON.parse(readFileSync(configFile, 'utf8'));
    expect(cfg.version).toBe(1);
    expect(cfg.active_profile).toBe('fresh');
    expect(cfg.schema_version).toBe('0.11.0');
  });

  test('preserves existing schema_version when present', async () => {
    writeProfile('alice');
    writeFileSync(configFile, JSON.stringify({
      version: 1,
      active_profile: 'old',
      schema_version: '0.9.0-experimental',
    }));
    await callUse({
      name: 'alice',
      __storeOptions: { profilesDir, configFile },
    });
    const cfg = JSON.parse(readFileSync(configFile, 'utf8'));
    expect(cfg.active_profile).toBe('alice');
    expect(cfg.schema_version).toBe('0.9.0-experimental');
  });

  test('rejects unknown profile name', async () => {
    await expect(
      callUse({
        name: 'ghost',
        __storeOptions: { profilesDir, configFile },
      }),
    ).rejects.toThrow(/__exit:1/);
    const errs = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errs).toContain('ghost');
    expect(errs).toContain('bounty profile add');
  });

  test('rejects malformed name', async () => {
    await expect(
      callUse({
        name: 'NOT VALID',
        __storeOptions: { profilesDir, configFile },
      }),
    ).rejects.toThrow(/__exit/);
  });

  test('refuses when name is missing', async () => {
    await expect(
      callUse({
        __storeOptions: { profilesDir, configFile },
      }),
    ).rejects.toThrow(/__exit/);
  });

  test('switches between profiles in a single config file', async () => {
    writeProfile('alice');
    writeProfile('bob');
    await callUse({
      name: 'alice',
      __storeOptions: { profilesDir, configFile },
    });
    let cfg = JSON.parse(readFileSync(configFile, 'utf8'));
    expect(cfg.active_profile).toBe('alice');

    await callUse({
      name: 'bob',
      __storeOptions: { profilesDir, configFile },
    });
    cfg = JSON.parse(readFileSync(configFile, 'utf8'));
    expect(cfg.active_profile).toBe('bob');
  });
});
