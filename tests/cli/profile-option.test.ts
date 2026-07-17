import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const cliSource = readFileSync(resolve(import.meta.dir, '../../src/cli/cli.ts'), 'utf8');

describe('global --profile CLI option', () => {
  test('registers --profile with -P alias as a global string option', () => {
    expect(cliSource).toContain(".option('profile'");
    expect(cliSource).toContain("alias: 'P'");
    expect(cliSource).toContain("type: 'string'");
    expect(cliSource).toContain('global: true');
  });

  test('registers profile middleware after global options', () => {
    expect(cliSource).toContain("from './middleware/profile-middleware.js'");
    expect(cliSource).toContain('profileMiddleware(');
  });
});
