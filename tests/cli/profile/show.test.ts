import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('bounty profile show', () => {
  let tempDir: string;
  let profilesDir: string;
  let configFile: string;
  let exitSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `bounty-show-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  async function callShow(args: Record<string, unknown>) {
    const mod = await import('../../../src/cli/commands/profile/show.js');
    await mod.showCommand.handler!(args as never);
  }

  function writeProfile(name: string, overrides: Record<string, unknown> = {}): void {
    const profile = {
      name,
      api_base: `https://${name}.example.com`,
      agent_id: '11111111-2222-3333-4444-555555555555',
      email: `${name}@example.com`,
      auth: {
        type: 'jwt',
        access_token: 'header.payload.signer-jwt-original',
        refresh_token: 'refresh-jwt-original',
        expires_at: 1893456000,
        scope: ['task:read', 'task:write'],
      },
      created_at: 1690000000,
      updated_at: 1700000000,
      last_used_at: 1700000000,
      ...overrides,
    };
    writeFileSync(join(profilesDir, `${name}.json`), JSON.stringify(profile, null, 2));
  }

  test('shows full profile with redacted tokens', async () => {
    writeProfile('alice');
    await callShow({
      name: 'alice',
      __storeOptions: { profilesDir, configFile },
    });
    const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n') +
      '\n' + errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('alice');
    expect(out).toContain('https://alice.example.com');
    expect(out).toContain('11111111-2222-3333-4444-555555555555');
    expect(out).toContain('alice@example.com');
    expect(out).toContain('task:read');
    expect(out).toContain('task:write');
    expect(out).not.toContain('header.payload.signer-jwt-original');
    expect(out).not.toContain('refresh-jwt-original');
    // Redaction should preserve a tail so users can identify the token.
    expect(out).toMatch(/inal|nier|nal/); // suffix of the original token
  });

  test('falls back to effective active profile when --name is missing', async () => {
    writeProfile('alice');
    writeFileSync(configFile, JSON.stringify({
      version: 1,
      active_profile: 'alice',
      schema_version: '0.11.0',
    }));
    await callShow({
      __storeOptions: { profilesDir, configFile },
    });
    const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('alice');
  });

  test('reports missing profile with remediation hint', async () => {
    await expect(
      callShow({
        name: 'ghost',
        __storeOptions: { profilesDir, configFile },
      }),
    ).rejects.toThrow(/__exit:1/);
    const errs = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errs).toContain('ghost');
    expect(errs).toContain('bounty profile add');
  });

  test('rejects malformed profile name', async () => {
    await expect(
      callShow({
        name: 'NOT VALID',
        __storeOptions: { profilesDir, configFile },
      }),
    ).rejects.toThrow(/__exit/);
  });

  test('handles profile without access_token gracefully', async () => {
    writeProfile('plain', {
      auth: { type: 'jwt' },
    });
    await callShow({
      name: 'plain',
      __storeOptions: { profilesDir, configFile },
    });
    const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('plain');
    expect(out).toContain('https://plain.example.com');
    // Should explicitly mention no token (or absence), not print garbage
    expect(out.toLowerCase()).toMatch(/no token|not set|none/);
  });

  test('shows the on-disk profile path', async () => {
    writeProfile('alice');
    await callShow({
      name: 'alice',
      __storeOptions: { profilesDir, configFile },
    });
    const out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('alice.json');
  });

  test('--json emits structured profile (tokens redacted)', async () => {
    writeProfile('alice');
    let captured = '';
    logSpy.mockImplementation((...args: unknown[]) => {
      captured += args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    });
    await callShow({
      name: 'alice',
      json: true,
      __storeOptions: { profilesDir, configFile },
    });
    const parsed = JSON.parse(captured);
    expect(parsed.name).toBe('alice');
    expect(parsed.api_base).toBe('https://alice.example.com');
    expect(parsed.auth.type).toBe('jwt');
    expect(parsed.auth.access_token).not.toBe('header.payload.signer-jwt-original');
    expect(typeof parsed.auth.access_token).toBe('string');
    expect(parsed.auth.access_token.length).toBeGreaterThan(0);
  });
});
