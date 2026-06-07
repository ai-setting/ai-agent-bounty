/**
 * Cleanup pass: remove stale .bak file, register ws handleError,
 * and ensure http handler logs once per request (M3+M4+M5)
 */

import { describe, it, expect } from 'bun:test';
import { existsSync } from 'fs';
import { join } from 'path';

describe('Cleanup pass (M3+M4+M5)', () => {
  it('M3: removes the stale src/tools/index.ts.bak file', () => {
    const bak = join(import.meta.dir, '..', '..', 'src', 'tools', 'index.ts.bak');
    expect(existsSync(bak)).toBe(false);
  });

  it('M4: IMWebSocketServer.handleError is reachable from the websocket handlers block', () => {
    // Read the source and assert that the websocket config wires
    // open/message/close AND error. We do not need to actually
    // trigger a socket error here.
    const src = require('fs').readFileSync(
      join(import.meta.dir, '..', '..', 'src', 'im', 'server', 'ws.ts'),
      'utf-8'
    );
    expect(src).toMatch(/open:\s*\(socket\)\s*=>/);
    expect(src).toMatch(/message:\s*\(socket/);
    expect(src).toMatch(/close:\s*\(socket\)\s*=>/);
    expect(src).toMatch(/error:\s*\(socket/);
  });

  it('M5: BountyHTTPServer.handleRequest does not log the same error twice', () => {
    // The catch block at the end of handleRequest must be the only
    // place that prints "Request error:". Sub-routes that catch
    // their own errors should re-throw or pass the response back
    // without re-logging.
    const src = require('fs').readFileSync(
      join(import.meta.dir, '..', '..', 'src', 'server', 'http', 'index.ts'),
      'utf-8'
    );
    const matches = src.match(/console\.error\(\s*['"]Request error:/g) || [];
    expect(matches.length).toBe(1);
  });
});
