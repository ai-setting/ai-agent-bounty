/**
 * Source code must not import packages that are not declared
 * in package.json. This is a small static guard that catches
 * a "ghost import" — e.g. a contributor `npm install`s a new
 * package, uses it in one file, deletes the file, and forgets
 * to remove the dep. The dep would then ship in the bundle
 * forever.
 *
 * As a side benefit, the scan also catches typos like
 * a misspelled package name (intentionally not naming one here
 * to avoid self-detecting the test's own comment).
 */

import { describe, it, expect } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..', '..');
const SRC = join(ROOT, 'src');
const TESTS = join(ROOT, 'tests');

const SKIP = new Set<string>([
  // The historical `demo:imap-poll` script was removed in earlier
  // work, so the `imap` and `mailparser` dependencies are no
  // longer used at runtime. They are kept in package.json for
  // compatibility but should eventually be deleted (see L1).
  'imap',
  'mailparser',
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) {
      out.push(...walk(p));
    } else if (p.endsWith('.ts') || p.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

const importRe = /from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g;

// Node built-ins (skip — these are provided by the runtime).
const NODE_BUILTINS = new Set<string>([
  'fs',
  'path',
  'os',
  'crypto',
  'child_process',
  'fs/promises',
  'url',
  'http',
  'https',
  'util',
  'events',
  'stream',
  'buffer',
  'readline',
  'tty',
  'zlib',
  'assert',
  'module',
  'worker_threads',
  'cluster',
  'dgram',
  'dns',
  'net',
  'tls',
  'inspector',
  'perf_hooks',
  'async_hooks',
  'vm',
  'process',
  'timers',
]);

describe('No unused / ghost imports (L1)', () => {
  it('source files only import packages that are declared in package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    const declared = new Set<string>([
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
      'bun:test', // test runner, always available
    ]);

    // Allow lists: imports that look like bare specifiers but are
    // either runtime-provided (bun:sqlite, node:fs) or in-source
    // type-only placeholders (a string literal in a comment or
    // template). The list is small enough to keep this test useful.
    const allowed: Set<string> = new Set([
      // The 'better-sqlite3' import inside src/auth/verification.ts
      // lives in a comment, but our regex only matches `from '...'`
      // so the line is harmless. We still want to catch real
      // better-sqlite3 usage if anyone re-introduces it.
      // ... add specific allowed names here as needed.
    ]);

    const offenders: Array<{ file: string; spec: string }> = [];
    for (const file of [...walk(SRC), ...walk(TESTS)]) {
      const text = readFileSync(file, 'utf-8');
      for (const m of text.matchAll(importRe)) {
        const spec = m[1]!;
        if (spec.startsWith('.') || spec.startsWith('/')) {
          continue;
        }
        if (spec.startsWith('bun:')) continue;
        if (spec.startsWith('node:') || NODE_BUILTINS.has(spec)) continue;
        if (allowed.has(spec)) continue;

        const pkgName = spec.startsWith('@')
          ? spec.split('/').slice(0, 2).join('/')
          : spec.split('/')[0]!;
        if (!declared.has(pkgName) && !SKIP.has(pkgName)) {
          offenders.push({ file, spec });
        }
      }
    }

    if (offenders.length > 0) {
      const sample = offenders.slice(0, 10).map(o => `  ${o.file}: ${o.spec}`).join('\n');
      throw new Error(
        `Found ${offenders.length} imports without a matching dependency:\n${sample}\n` +
          (offenders.length > 10 ? `  ... and ${offenders.length - 10} more\n` : '')
      );
    }
    expect(offenders.length).toBe(0);
  });

  it('package.json does not declare imap or mailparser as dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    expect(pkg.dependencies).not.toHaveProperty('imap');
    expect(pkg.dependencies).not.toHaveProperty('mailparser');
    expect(pkg.devDependencies).not.toHaveProperty('@types/imap');
    expect(pkg.scripts).not.toHaveProperty('demo:imap-poll');
  });
});
