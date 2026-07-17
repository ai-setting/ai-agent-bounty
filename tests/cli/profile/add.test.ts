import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('bounty profile add', () => {
  let tempDir: string;
  let profilesDir: string;
  let configFile: string;
  let exitSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `bounty-add-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  async function callAdd(args: Record<string, unknown>) {
    const mod = await import('../../../src/cli/commands/profile/add.js');
    await mod.addCommand.handler!(args as never);
  }

  test('creates a profile with required name and api_base', async () => {
    await callAdd({
      name: 'alice',
      'api-base': 'https://api.example.com',
      __storeOptions: { profilesDir, configFile },
    });

    const file = join(profilesDir, 'alice.json');
    expect(existsSync(file)).toBe(true);
    const data = JSON.parse(readFileSync(file, 'utf8'));
    expect(data.name).toBe('alice');
    expect(data.api_base).toBe('https://api.example.com');
    expect(data.auth.type).toBe('jwt');
    expect(typeof data.created_at).toBe('number');
    expect(data.updated_at).toBe(data.created_at);
  });

  test('writes token, agent_id, and email when provided', async () => {
    await callAdd({
      name: 'bob',
      'api-base': 'http://localhost:4000',
      token: 'jwt-bob',
      'agent-id': '11111111-2222-3333-4444-555555555555',
      email: 'bob@example.com',
      __storeOptions: { profilesDir, configFile },
    });

    const data = JSON.parse(readFileSync(join(profilesDir, 'bob.json'), 'utf8'));
    expect(data.auth.access_token).toBe('jwt-bob');
    expect(data.agent_id).toBe('11111111-2222-3333-4444-555555555555');
    expect(data.email).toBe('bob@example.com');
  });

  test('rejects invalid profile names with exit 1', async () => {
    await expect(
      callAdd({
        name: 'Bad Name!',
        'api-base': 'https://api.example.com',
        __storeOptions: { profilesDir, configFile },
      }),
    ).rejects.toThrow(/__exit:1/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const errs = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errs).toContain('Bad Name');
  });

  test('rejects when name is missing', async () => {
    await expect(
      callAdd({
        'api-base': 'https://api.example.com',
        __storeOptions: { profilesDir, configFile },
      }),
    ).rejects.toThrow(/__exit/);
    expect(existsSync(join(profilesDir, 'undefined.json'))).toBe(false);
  });

  test('rejects duplicate profile (file already exists)', async () => {
    await callAdd({
      name: 'carol',
      'api-base': 'https://api.example.com',
      __storeOptions: { profilesDir, configFile },
    });
    await expect(
      callAdd({
        name: 'carol',
        'api-base': 'https://other.example.com',
        __storeOptions: { profilesDir, configFile },
      }),
    ).rejects.toThrow(/__exit:1/);
    const errs = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errs).toContain('carol');
    expect(errs.toLowerCase()).toMatch(/exist|already/);
  });

  test('rejects duplicate when existing file is corrupted', async () => {
    // Write a corrupted file with the target name
    const fs = await import('fs');
    fs.writeFileSync(join(profilesDir, 'dan.json'), '{ this is not valid json');

    await expect(
      callAdd({
        name: 'dan',
        'api-base': 'https://api.example.com',
        __storeOptions: { profilesDir, configFile },
      }),
    ).rejects.toThrow(/__exit:1/);
  });

  test('rejects api_base that is not a URL', async () => {
    await expect(
      callAdd({
        name: 'eve',
        'api-base': 'not-a-url',
        __storeOptions: { profilesDir, configFile },
      }),
    ).rejects.toThrow(/__exit/);
    expect(existsSync(join(profilesDir, 'eve.json'))).toBe(false);
  });

  test('rejects api_base that is ftp:// (wrong scheme)', async () => {
    await expect(
      callAdd({
        name: 'frank',
        'api-base': 'ftp://api.example.com',
        __storeOptions: { profilesDir, configFile },
      }),
    ).rejects.toThrow(/__exit/);
  });

  test('warns when token is omitted (does not fail)', async () => {
    await callAdd({
      name: 'gina',
      'api-base': 'https://api.example.com',
      __storeOptions: { profilesDir, configFile },
    });
    const data = JSON.parse(readFileSync(join(profilesDir, 'gina.json'), 'utf8'));
    expect(data.auth.access_token).toBeUndefined();
    const allLog = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(allLog).toMatch(/auth login|bounty auth login/);
    const allLogAndErr = allLog + '\n' + errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(allLogAndErr).toMatch(/bounty auth login/);
  });

  test('hints to run bounty profile use after success', async () => {
    await callAdd({
      name: 'hank',
      'api-base': 'https://api.example.com',
      token: 'jwt',
      __storeOptions: { profilesDir, configFile },
    });
    const allLog = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(allLog).toMatch(/bounty profile use hank|profile use hank/);
  });
});
