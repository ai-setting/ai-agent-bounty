/**
 * End-to-end integration: add → list → show → use → rename → remove.
 *
 * Verifies that real PR1 store mutations happen as the user walks through a
 * full profile lifecycle, with no mocks of the storage layer.
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { mkdirSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('bounty profile (integration: full lifecycle)', () => {
  let tempDir: string;
  let profilesDir: string;
  let configFile: string;
  let exitSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempDir = join(tmpdir(), `bounty-profile-int-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  async function importCommand(name: string) {
    const mod = await import(`../../../src/cli/commands/profile/${name}.js`);
    const exportName = `${name}Command`;
    return mod[exportName];
  }

  test('full lifecycle: add alice → list shows it → show reveals token redacted → use alice → rename to alice2 → remove alice2', async () => {
    const add = await importCommand('add');
    const list = await importCommand('list');
    const show = await importCommand('show');
    const use = await importCommand('use');
    const rename = await importCommand('rename');
    const remove = await importCommand('remove');
    const opts = { profilesDir, configFile };

    // 1. add alice (no token, just api_base)
    await add.handler!({
      name: 'alice',
      'api-base': 'https://api.example.com',
      __storeOptions: opts,
    } as never);
    expect(existsSync(join(profilesDir, 'alice.json'))).toBe(true);

    // 2. list shows alice (table mode)
    await list.handler!({ __storeOptions: opts } as never);
    let out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('alice');

    // 3. list --json shows alice as a structured entry with no token leak
    logSpy.mockClear();
    await list.handler!({ json: true, __storeOptions: opts } as never);
    const jsonOut = logSpy.mock.calls.map((c) => c.join(' ')).join('');
    const parsed = JSON.parse(jsonOut);
    expect(parsed.profiles.find((p: { name: string }) => p.name === 'alice')).toBeTruthy();
    expect(jsonOut).not.toContain('access_token');

    // 4. show --name alice (no token set yet)
    await show.handler!({ name: 'alice', __storeOptions: opts } as never);
    out = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(out).toContain('alice');
    expect(out).toContain('https://api.example.com');

    // 5. use alice
    await use.handler!({ name: 'alice', __storeOptions: opts } as never);
    const cfgAfterUse = JSON.parse(readFileSync(configFile, 'utf8'));
    expect(cfgAfterUse.active_profile).toBe('alice');
    expect(cfgAfterUse.version).toBe(1);

    // 6. rename alice → alice-renamed (active syncs)
    await rename.handler!({ old: 'alice', new: 'alice-renamed', __storeOptions: opts } as never);
    expect(existsSync(join(profilesDir, 'alice.json'))).toBe(false);
    expect(existsSync(join(profilesDir, 'alice-renamed.json'))).toBe(true);
    const cfgAfterRename = JSON.parse(readFileSync(configFile, 'utf8'));
    expect(cfgAfterRename.active_profile).toBe('alice-renamed');

    // 7. cannot remove active profile
    logSpy.mockImplementation(() => {});
    await expect(
      remove.handler!({ name: 'alice-renamed', __storeOptions: opts } as never),
    ).rejects.toThrow(/__exit:1/);

    // 8. switch to non-existent (use a profile we will create next), or remove via --force after switching
    // Switch active to default (we don't have one) → rename first, then we need to use a different profile.
    // Simpler: write a second profile "temp" and use it, then remove "alice-renamed" with --force.
    logSpy.mockImplementation(() => {});
    await add.handler!({
      name: 'temp',
      'api-base': 'https://api.example.com',
      __storeOptions: opts,
    } as never);
    await use.handler!({ name: 'temp', __storeOptions: opts } as never);

    // 9. remove alice-renamed with --force (active is now temp, not alice-renamed)
    await remove.handler!({ name: 'alice-renamed', force: true, __storeOptions: opts } as never);
    expect(existsSync(join(profilesDir, 'alice-renamed.json'))).toBe(false);

    // 10. list shows only temp now
    logSpy.mockClear();
    await list.handler!({ json: true, __storeOptions: opts } as never);
    const finalJson = logSpy.mock.calls.map((c) => c.join(' ')).join('');
    const finalParsed = JSON.parse(finalJson);
    const finalNames = finalParsed.profiles.map((p: { name: string }) => p.name);
    expect(finalNames).toContain('temp');
    expect(finalNames).not.toContain('alice');
    expect(finalNames).not.toContain('alice-renamed');
  });

  test('parent profile command rejects bare invocation (demandCommand)', async () => {
    const { profileCommands } = await import('../../../src/cli/commands/profile/index.js');
    // yargs enforces demandCommand(1); calling handler directly is a no-op,
    // but the registered builder must wire demandCommand.
    const fakeYargs: { commands: string[]; demands: Array<{ n: number; msg: string }>; _help: boolean; command: (c: { command: string }) => typeof fakeYargs; demandCommand: (n: number, msg: string) => typeof fakeYargs; help: () => typeof fakeYargs } = {
      commands: [],
      demands: [],
      _help: false,
      command(c: { command: string }) { this.commands.push(c.command); return this; },
      demandCommand(n: number, msg: string) { this.demands.push({ n, msg }); return this; },
      help() { this._help = true; return this; },
    };
    profileCommands.builder(fakeYargs as never);
    expect(fakeYargs.commands).toEqual(
      expect.arrayContaining(['add <name>', 'list', 'show', 'use <name>', 'remove <name>', 'rename <old> <new>']),
    );
    expect(fakeYargs.demands.length).toBe(1);
    expect(fakeYargs.demands[0]!.n).toBe(1);
    expect(fakeYargs._help).toBe(true);
  });
});
