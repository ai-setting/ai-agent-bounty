import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('profileMiddleware', () => {
  let tempDir: string;
  let profilesDir: string;
  let configFile: string;
  let originalEnv: string | undefined;
  let exitSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `bounty-mw-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    profilesDir = join(tempDir, 'profiles');
    configFile = join(tempDir, 'config.json');
    mkdirSync(profilesDir, { recursive: true });
    originalEnv = process.env.BOUNTY_PROFILE;
    delete process.env.BOUNTY_PROFILE;
    exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit called: ${code}`);
    }) as never);
    errorSpy = spyOn(console, 'error').mockImplementation(() => {});
    (await import('../../../src/cli/config/context.js')).ProfileContext.clear();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalEnv === undefined) delete process.env.BOUNTY_PROFILE;
    else process.env.BOUNTY_PROFILE = originalEnv;
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function writeProfile(name: string): void {
    writeFileSync(join(profilesDir, `${name}.json`), JSON.stringify({
      name,
      api_base: `https://${name}.example.com`,
      auth: { type: 'jwt', access_token: `${name}-token` },
      created_at: 1,
      updated_at: 1,
    }));
  }

  test('CLI profile flag resolves and injects context', async () => {
    writeProfile('alice');
    const { profileMiddleware } = await import('../../../src/cli/middleware/profile-middleware.js');
    profileMiddleware({ profile: 'alice' }, { profilesDir, configFile });
    expect(exitSpy).not.toHaveBeenCalled();
    expect((await import('../../../src/cli/config/context.js')).ProfileContext.getActive()?.name).toBe('alice');
  });

  test('BOUNTY_PROFILE env resolves and injects context', async () => {
    writeProfile('bob');
    process.env.BOUNTY_PROFILE = 'bob';
    const { profileMiddleware } = await import('../../../src/cli/middleware/profile-middleware.js');
    profileMiddleware({}, { profilesDir, configFile });
    expect((await import('../../../src/cli/config/context.js')).ProfileContext.getActive()?.name).toBe('bob');
  });

  test('explicit missing profile exits with code 2 and remediation list', async () => {
    writeProfile('alice'); writeProfile('bob');
    const { profileMiddleware } = await import('../../../src/cli/middleware/profile-middleware.js');
    expect(() => profileMiddleware({ profile: 'ghost' }, { profilesDir, configFile })).toThrow(/process\.exit called: 2/);
    expect(exitSpy).toHaveBeenCalledWith(2);
    const output = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('ghost');
    expect(output).toContain('alice');
    expect(output).toContain('bob');
    expect(output).toContain('bounty profile add');
  });

  test('default profile is used when no flag or env is set', async () => {
    writeProfile('default');
    const { profileMiddleware } = await import('../../../src/cli/middleware/profile-middleware.js');
    profileMiddleware({}, { profilesDir, configFile });
    expect((await import('../../../src/cli/config/context.js')).ProfileContext.getActive()?.name).toBe('default');
  });

  test('missing implicit default does not exit and clears context', async () => {
    const { ProfileContext } = await import('../../../src/cli/config/context.js');
    ProfileContext.setActive({ name: 'old', api_base: 'https://old.example.com', auth: { type: 'jwt' }, created_at: 1, updated_at: 1 });
    const { profileMiddleware } = await import('../../../src/cli/middleware/profile-middleware.js');
    profileMiddleware({}, { profilesDir, configFile });
    expect(exitSpy).not.toHaveBeenCalled();
    expect(ProfileContext.getActive()).toBeNull();
  });
});
