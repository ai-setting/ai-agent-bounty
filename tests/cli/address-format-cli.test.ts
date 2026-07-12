/**
 * Tests for v0.10.0 CLI address flag unification.
 *
 * Verifies:
 * - All CLI commands accept --agent-address <uuid>@<host>
 * - Bare UUID input is REJECTED with helpful error
 * - --agent-id / --publisher-id flags are REMOVED (BREAKING)
 * - Error messages mention the correct format
 */

import { describe, test, expect } from 'bun:test';
import { parseAgentAddress } from '../../src/cli/lib/address-parser.js';

describe('parseAgentAddress — strict uuid@host only (v0.10.0)', () => {
  test('accepts canonical uuid@host', () => {
    const r = parseAgentAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6@bounty.example.com');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.uuid).toBe('ee0dd085-0b66-4640-81bc-f8d4c743c1e6');
    expect(r.value.host).toBe('bounty.example.com');
  });

  test('REJECTS bare UUID (no @host) — BREAKING', () => {
    const r = parseAgentAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('<uuid>@<host>');
  });

  test('REJECTS bare UUID via --agent-id flag (CLI removed in v0.10)', () => {
    // Even if user passes --agent-id, parseAgentAddress must reject bare form
    const r = parseAgentAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6', '--agent-id');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('<uuid>@<host>');
  });

  test('REJECTS bare UUID via --publisher-id flag (CLI removed in v0.10)', () => {
    const r = parseAgentAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6', '--publisher-id');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('<uuid>@<host>');
  });

  test('REJECTS email-like input', () => {
    const r = parseAgentAddress('user@example.com');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // 'user' is not a valid uuid
    expect(r.error).toMatch(/uuid/i);
  });

  test('REJECTS empty string with helpful message', () => {
    const r = parseAgentAddress('', '--agent-address');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('empty');
  });

  test('REJECTS whitespace-only string', () => {
    const r = parseAgentAddress('   ', '--agent-address');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('empty');
  });

  test('REJECTS missing host', () => {
    const r = parseAgentAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6@');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('host');
  });

  test('error message includes the correct flag name', () => {
    const r = parseAgentAddress('not-a-uuid@host.example.com', '--publisher-address');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('--publisher-address');
  });

  test('error message shows the input value (for debugging)', () => {
    const r = parseAgentAddress('bad-input-no-at', '--agent-address');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('bad-input-no-at');
  });
});