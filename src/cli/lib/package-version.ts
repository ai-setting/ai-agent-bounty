/**
 * Package version resolver
 *
 * Resolves @ai-setting/agent-bounty[-standalone]'s own package version
 * regardless of the current working directory. This is important because
 * the CLI binary is often run from arbitrary cwd (e.g., `bounty --version`
 * from a user's home directory), and the naive `process.cwd()/package.json`
 * lookup would pick up an unrelated package.json.
 *
 * Accepts either of these package names:
 *   - @ai-setting/agent-bounty        (main package, source/dev mode)
 *   - @ai-setting/agent-bounty-standalone (standalone binary on npmjs)
 *
 * Resolution strategy (in order):
 *   1. `process.cwd()/package.json` whose name matches ours (dev mode fast path)
 *   2. Walk up from `process.execPath` (standalone binary like
 *      `bounty-standalone/bin/bounty-linux-x64` → `../package.json`)
 *   3. Walk up from `import.meta.url` (bundled dist like
 *      `dist/bin/bounty.js` → walk up to find our package.json)
 *
 * Returns "0.0.0-unknown" if no matching package.json is found.
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const OUR_PACKAGE_NAMES = new Set([
  '@ai-setting/agent-bounty',
  '@ai-setting/agent-bounty-standalone',
]);
const FALLBACK_VERSION = '0.0.0-unknown';

interface PackageJson {
  name?: string;
  version?: string;
}

function tryReadPackage(pkgPath: string): PackageJson | null {
  try {
    if (!existsSync(pkgPath)) return null;
    const raw = readFileSync(pkgPath, 'utf-8');
    return JSON.parse(raw) as PackageJson;
  } catch {
    return null;
  }
}

/**
 * Type guard: returns true if pkg is one of our packages and has a string version.
 * Narrows pkg.version to string when true.
 */
function isOurPackage(pkg: PackageJson | null): pkg is PackageJson & { version: string } {
  return (
    pkg !== null &&
    typeof pkg.name === 'string' &&
    OUR_PACKAGE_NAMES.has(pkg.name) &&
    typeof pkg.version === 'string'
  );
}

/**
 * Walk up from `startDir` looking for a package.json whose name is our package.
 * Stops at filesystem root.
 */
function findOurPackageFromDir(startDir: string): PackageJson | null {
  let current = startDir;
  const visited: string[] = [];

  // Walk up at most 10 levels to avoid infinite loops on weird FS layouts
  for (let i = 0; i < 10; i++) {
    if (visited.includes(current)) break; // cycle protection
    visited.push(current);

    const pkg = tryReadPackage(join(current, 'package.json'));
    if (isOurPackage(pkg)) return pkg;

    const parent = dirname(current);
    if (parent === current) break; // filesystem root
    current = parent;
  }
  return null;
}

/**
 * Get the package version for @ai-setting/agent-bounty.
 *
 * This is exported so it can be unit-tested. The function reads the
 * package.json from multiple candidate locations and returns the version
 * of the first match where `name === "@ai-setting/agent-bounty"`.
 */
export function getPackageVersion(): string {
  // Strategy 1: cwd/package.json (dev mode fast path)
  const cwdPkg = tryReadPackage(join(process.cwd(), 'package.json'));
  if (isOurPackage(cwdPkg)) return cwdPkg.version;

  // Strategy 2: walk up from process.execPath (standalone binary)
  // For a standalone binary like `bounty-standalone/bin/bounty-linux-x64`,
  // the package.json is at `../package.json` from execPath's dirname.
  try {
    const execDir = dirname(process.execPath);
    const pkg = findOurPackageFromDir(execDir);
    if (isOurPackage(pkg)) return pkg.version;
  } catch {
    // process.execPath may not be available in some runtimes
  }

  // Strategy 3: walk up from import.meta.url (bundled dist or npm install)
  try {
    if (typeof import.meta.url === 'string') {
      const modulePath = fileURLToPath(import.meta.url);
      const moduleDir = dirname(modulePath);
      const pkg = findOurPackageFromDir(moduleDir);
      if (isOurPackage(pkg)) return pkg.version;
    }
  } catch {
    // import.meta.url may not be available in some runtimes
  }

  return FALLBACK_VERSION;
}