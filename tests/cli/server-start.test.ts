/**
 * Server `start` command should be robust (H4)
 *
 * Background: src/cli/commands/server/start.ts declared `--port` with
 * `type: 'string'` and then passed it via `BOUNTY_PORT: port` straight
 * into the child's environment. That works most of the time, but:
 *
 *   1. The health probe runs exactly once, 2s after spawn, so on slow
 *      machines it reports "Server starting in background" even when
 *      the server is actually up.
 *   2. There is no validation that `port` is a valid integer; passing
 *      a non-numeric value (e.g. `bounty server start -p abc`) crashes
 *      the server with a confusing error.
 *
 * New behavior:
 *   - Validate port is a 1..65535 integer, exit 2 with a helpful
 *     error otherwise.
 *   - Poll /health for up to N attempts (default 20 × 250ms) instead
 *     of a single hard-coded 2s sleep.
 *
 * These tests are unit-level: we extract the port-validation helper
 * so we don't have to spawn a child process in CI.
 */

import { describe, it, expect } from 'bun:test';
import { parsePort, isValidPort, waitForHealth } from '../../src/cli/commands/server/start';

describe('server start port handling (H4)', () => {
  describe('isValidPort', () => {
    it('accepts well-known ports', () => {
      expect(isValidPort('4000')).toBe(true);
      expect(isValidPort('80')).toBe(true);
      expect(isValidPort('65535')).toBe(true);
    });

    it('rejects zero, negative, out-of-range, and non-numeric', () => {
      expect(isValidPort('0')).toBe(false);
      expect(isValidPort('-1')).toBe(false);
      expect(isValidPort('65536')).toBe(false);
      expect(isValidPort('abc')).toBe(false);
      expect(isValidPort('')).toBe(false);
      expect(isValidPort('4000abc')).toBe(false);
    });
  });

  describe('parsePort', () => {
    it('returns the integer for valid input', () => {
      expect(parsePort('4000')).toBe(4000);
      expect(parsePort('80')).toBe(80);
    });

    it('returns null for invalid input', () => {
      expect(parsePort('abc')).toBeNull();
      expect(parsePort('65536')).toBeNull();
      expect(parsePort('-1')).toBeNull();
      expect(parsePort('')).toBeNull();
    });
  });

  describe('waitForHealth', () => {
    it('returns true as soon as /health returns 2xx', async () => {
      // Spin up a minimal Bun.serve with a /health endpoint.
      const server = Bun.serve({
        port: 0,
        fetch: (req) => {
          if (new URL(req.url).pathname === '/health') {
            return new Response(JSON.stringify({ status: 'ok' }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response('not found', { status: 404 });
        },
      });

      try {
        const ok = await waitForHealth(
          `http://localhost:${server.port}`,
          20,
          25
        );
        expect(ok).toBe(true);
      } finally {
        server.stop();
      }
    });

    it('returns false when /health never responds 2xx', async () => {
      // Port 1 is reserved and not bound to anything we can reach.
      const ok = await waitForHealth('http://127.0.0.1:1', 2, 25);
      expect(ok).toBe(false);
    });
  });
});
