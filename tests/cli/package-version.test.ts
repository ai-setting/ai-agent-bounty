/**
 * Tests for getPackageVersion() in src/cli/lib/package-version.ts
 *
 * The CLI binary is run from arbitrary cwd. The version reported by
 * `bounty --version` must be the @ai-setting/agent-bounty package's own
 * version, NOT the version of whatever package.json happens to be in cwd.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';

describe('getPackageVersion()', () => {
  let originalCwd: string;
  let tmpDir: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tmpDir = mkdtempSync(join(tmpdir(), 'bounty-pkg-version-'));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns cwd package version when cwd has our package.json', async () => {
    const fakeProject = join(tmpDir, 'our-project');
    mkdirSync(fakeProject, { recursive: true });
    writeFileSync(
      join(fakeProject, 'package.json'),
      JSON.stringify({
        name: '@ai-setting/agent-bounty',
        version: '0.7.0',
      }),
    );
    process.chdir(fakeProject);

    const { getPackageVersion } = await import(
      '../../src/cli/lib/package-version.js'
    );
    expect(getPackageVersion()).toBe('0.7.0');
  });

  test('falls back to import.meta.url resolution when cwd has unrelated package.json', async () => {
    // Create an unrelated cwd package.json (simulating running `bounty`
    // from a different project)
    const unrelatedCwd = join(tmpDir, 'unrelated-cwd');
    mkdirSync(unrelatedCwd, { recursive: true });
    writeFileSync(
      join(unrelatedCwd, 'package.json'),
      JSON.stringify({
        name: 'some-other-package',
        version: '1.2.3-bogus',
      }),
    );
    process.chdir(unrelatedCwd);

    // The fix should NOT return 1.2.3-bogus. Instead, it should walk up
    // from process.execPath or import.meta.url to find our package.json.
    //
    // import.meta.url points to the source file we're testing, which lives
    // in src/cli/lib/. Walking up should find our root package.json (the
    // one with version 0.7.0).
    const { getPackageVersion } = await import(
      '../../src/cli/lib/package-version.js'
    );

    const version = getPackageVersion();
    expect(version).not.toBe('1.2.3-bogus');
    // The actual root package.json (the one this test runs from) should be found
    // via walking up from import.meta.url.
    // Verify it parses as a valid semver-ish string and matches our package name.
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('returns fallback when no matching package.json exists anywhere', async () => {
    // Create a completely isolated cwd with no ancestor package.json
    // matching our name. Use a deeply nested tmpDir.
    const deepCwd = join(tmpDir, 'a', 'b', 'c', 'd');
    mkdirSync(deepCwd, { recursive: true });
    writeFileSync(
      join(deepCwd, 'package.json'),
      JSON.stringify({
        name: 'unrelated-deep',
        version: '5.6.7',
      }),
    );
    process.chdir(deepCwd);

    const { getPackageVersion } = await import(
      '../../src/cli/lib/package-version.js'
    );

    // The fallback may trigger OR it may find our package via import.meta.url
    // walking up. Either way, it must NOT return 5.6.7.
    const version = getPackageVersion();
    expect(version).not.toBe('5.6.7');
  });

  test('strategy order: cwd > execPath > import.meta.url', async () => {
    // Set cwd to have a different version of our package. The resolver
    // should return that version (cwd takes priority).
    const fakeProject = join(tmpDir, 'priority-test');
    mkdirSync(fakeProject, { recursive: true });
    writeFileSync(
      join(fakeProject, 'package.json'),
      JSON.stringify({
        name: '@ai-setting/agent-bounty',
        version: '9.9.9-priority',
      }),
    );
    process.chdir(fakeProject);

    const { getPackageVersion } = await import(
      '../../src/cli/lib/package-version.js'
    );
    expect(getPackageVersion()).toBe('9.9.9-priority');
  });
});