/**
 * v0.14 strict email-flag helper tests (RED → GREEN → REFACTOR).
 *
 * Helper contract — `requireEmailFlag` + `resolveActiveProfileEmail`:
 *   1. Precedence (explicit `--xxx-email` > ProfileContext.active.email > error).
 *   2. Rejects `<uuid>@<host>` and bare UUIDs via `parseEmail` boundary.
 *   3. When no explicit email and no active profile → exit 1 with friendly
 *      "use --xxx-email <your-registered-email> or `bounty profile use <name>`"
 *      hint (matches the `bounty-task/grab.ts` strict contract).
 *   4. When no explicit email but active profile.email exists → resolved.
 *   5. When explicit email + active profile.email → explicit wins.
 *   6. When explicit email is empty string ("") → treated as no explicit
 *      (NOT as malformed); falls through to profile / error path.
 *   7. Custom field name (`--publisher-email`) gets the right hint hint.
 *
 * The runtime RED tests assert:
 *   - module exports `requireEmailFlag`, `resolveActiveProfileEmail`,
 *     and `parseEmailFromArgv`.
 *   - happy path: valid email in argv → ok + value
 *   - legacy input rejected: `<uuid>@<host>` and bare UUID → ok:false with hint
 *   - profile fallback returns email from ProfileContext.active.email
 *   - friendly error when nothing is available
 */

import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
} from 'bun:test';

import {
  requireEmailFlag,
  resolveActiveProfileEmail,
  parseEmailFromArgv,
} from '../../../src/cli/lib/email-flag.js';

import { ProfileContext } from '../../../src/cli/config/context.js';

import type { BountyProfile } from '../../../src/cli/config/types.js';

const minimalProfile: BountyProfile = {
  name: 'demo',
  api_base: 'http://localhost:4000',
  auth: { type: 'jwt', access_token: 'tok', refresh_token: null, expires_at: 0 },
  email: 'alice@example.com',
  agent_id: '8de9b6aa-5781-4a65-be96-45185fb7c8b1',
  created_at: 0,
  updated_at: 0,
};

describe('email-flag helper — requireEmailFlag (RED)', () => {
  let captured: { exitCode: number | null; stderr: string[] };
  let origExit: typeof process.exit;
  let origErr: typeof console.error;
  let origActive: BountyProfile | null;

  beforeEach(() => {
    captured = { exitCode: null, stderr: [] };
    origExit = process.exit;
    origErr = console.error;
    origActive = ProfileContext.getActive();
    (process as any).exit = (code?: number) => {
      captured.exitCode = code ?? 0;
      throw new Error(`exit-${code}`);
    };
    console.error = (...args: unknown[]) => {
      captured.stderr.push(String(args[0] ?? ''));
    };
    ProfileContext.setActive(null);
  });

  afterEach(() => {
    (process as any).exit = origExit;
    console.error = origErr;
    ProfileContext.setActive(origActive);
  });

  // ============ Happy paths ============

  test('happy path: explicit valid email wins → ok + value', () => {
    const result = requireEmailFlag('email', { email: 'alice@example.com' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('alice@example.com');
  });

  test('happy path: explicit valid email via -e alias → ok + value', () => {
    const result = requireEmailFlag('email', { e: 'bob@example.com' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('bob@example.com');
  });

  test('happy path: explicit --publisher-email for publish', () => {
    const result = requireEmailFlag('publisher-email', {
      'publisher-email': 'carol@example.com',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('carol@example.com');
  });

  // ============ Legacy shape rejection ============

  test('REJECTS bare UUID input (must use --email)', () => {
    const result = requireEmailFlag('email', {
      email: '8de9b6aa-5781-4000-8000-000000000001',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/--email/);
      expect(result.error).toMatch(/registered-email/);
    }
  });

  test('REJECTS <uuid>@<host> input (must use --email)', () => {
    const result = requireEmailFlag('email', {
      email: '8de9b6aa-5781-4000-8000-000000000001@bounty.local',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/--email/);
    }
  });

  test('REJECTS malformed email (no @)', () => {
    const result = requireEmailFlag('email', { email: 'not-an-email' });
    expect(result.ok).toBe(false);
  });

  test('REJECTS empty string treated as not-supplied', () => {
    const result = requireEmailFlag('email', { email: '' });
    // empty is "not supplied" → falls to profile / friendly error
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/--email/);
    }
  });

  // ============ Profile fallback ============

  test('profile fallback: ProfileContext.active.email used when no explicit', () => {
    ProfileContext.setActive(minimalProfile);
    const result = requireEmailFlag('email', {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('alice@example.com');
  });

  test('explicit email wins over profile', () => {
    ProfileContext.setActive(minimalProfile);
    const result = requireEmailFlag('email', { email: 'dave@example.com' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('dave@example.com');
  });

  test('profile without .email field → friendly error (no implicit agent_id)', () => {
    const profileNoEmail: BountyProfile = {
      ...minimalProfile,
      email: undefined,
    };
    ProfileContext.setActive(profileNoEmail);
    const result = requireEmailFlag('email', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/--email/);
      expect(result.error).toMatch(/profile use/);
    }
  });

  // ============ No source + no profile → friendly error ============

  test('friendly error when no explicit and no profile', () => {
    ProfileContext.setActive(null);
    const result = requireEmailFlag('email', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/--email/);
    }
  });

  // ============ Custom field → kebab hint ============

  test('--publisher-email field hint is "--publisher-email"', () => {
    const result = requireEmailFlag('publisher-email', {
      email: 'not-an-email',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/--publisher-email/);
    }
  });
});

describe('email-flag helper — resolveActiveProfileEmail (RED)', () => {
  test('returns email from active profile', () => {
    ProfileContext.setActive(minimalProfile);
    expect(resolveActiveProfileEmail()).toBe('alice@example.com');
  });

  test('returns undefined when no active profile', () => {
    ProfileContext.setActive(null);
    expect(resolveActiveProfileEmail()).toBeUndefined();
  });

  test('returns undefined when active profile lacks email', () => {
    ProfileContext.setActive({
      ...minimalProfile,
      email: undefined,
    });
    expect(resolveActiveProfileEmail()).toBeUndefined();
  });
});

describe('email-flag helper — parseEmailFromArgv (RED)', () => {
  test('returns ok+value for valid explicit email', () => {
    const r = parseEmailFromArgv({ email: 'eve@example.com' }, 'email');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('eve@example.com');
  });

  test('returns ok:false with --email hint for legacy shape', () => {
    const r = parseEmailFromArgv(
      { email: '8de9b6aa-5781-4000-8000-000000000001@bounty.local' },
      'email',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/--email/);
  });

  test('returns ok:false (no-source) when argv missing the field', () => {
    const r = parseEmailFromArgv({}, 'email');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/--email/);
      expect(r.error).toMatch(/profile/);
    }
  });

  test('returns ok:false (no-source) when email is empty string', () => {
    const r = parseEmailFromArgv({ email: '' }, 'email');
    expect(r.ok).toBe(false);
  });
});
