/**
 * Tests for src/lib/address.ts (v0.10.0 STRICT parser).
 *
 * v0.10.0 BREAKING: parseAddress REJECTS bare UUID, email-like, empty,
 * multi-@, and non-string inputs. Only `<uuid>@<host>` is accepted.
 */

import { describe, test, expect } from 'bun:test';

describe('parseAddress — strict uuid@host parser (v0.10.0)', () => {
  test('accepts canonical uuid@host', async () => {
    const { parseAddress } = await import('../../src/lib/address.js');
    const r = parseAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6@bounty.example.com');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.uuid).toBe('ee0dd085-0b66-4640-81bc-f8d4c743c1e6');
    expect(r.value.host).toBe('bounty.example.com');
    expect(r.value.raw).toBe('ee0dd085-0b66-4640-81bc-f8d4c743c1e6@bounty.example.com');
  });

  test('REJECTS bare UUID (no @host) — v0.10 BREAKING', async () => {
    const { parseAddress } = await import('../../src/lib/address.js');
    const r = parseAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('<uuid>@<host>');
  });

  test('REJECTS email-like (uuid with dots) — v0.10 BREAKING', async () => {
    const { parseAddress } = await import('../../src/lib/address.js');
    const r = parseAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6@bounty.example.com.evil@bad');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/multiple|@/);
  });

  test('REJECTS invalid uuid (not v1-v5 format)', async () => {
    const { parseAddress } = await import('../../src/lib/address.js');
    const r = parseAddress('not-a-uuid@host.example.com');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('uuid');
  });

  test('REJECTS invalid host (contains invalid chars)', async () => {
    const { parseAddress } = await import('../../src/lib/address.js');
    const r = parseAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6@bad__host');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('host');
  });

  test('REJECTS empty string', async () => {
    const { parseAddress } = await import('../../src/lib/address.js');
    const r = parseAddress('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('empty');
  });

  test('REJECTS whitespace-only string', async () => {
    const { parseAddress } = await import('../../src/lib/address.js');
    const r = parseAddress('   ');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('empty');
  });

  test('REJECTS multiple @ characters', async () => {
    const { parseAddress } = await import('../../src/lib/address.js');
    const r = parseAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6@host1@host2');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/multiple|@/);
  });

  test('REJECTS missing uuid before @', async () => {
    const { parseAddress } = await import('../../src/lib/address.js');
    const r = parseAddress('@host.example.com');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/uuid|missing/i);
  });

  test('REJECTS missing host after @', async () => {
    const { parseAddress } = await import('../../src/lib/address.js');
    const r = parseAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6@');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/host|missing/i);
  });

  test('REJECTS non-string inputs', async () => {
    const { parseAddress } = await import('../../src/lib/address.js');
    expect(parseAddress(null).ok).toBe(false);
    expect(parseAddress(undefined).ok).toBe(false);
    expect(parseAddress(123).ok).toBe(false);
    expect(parseAddress({}).ok).toBe(false);
    expect(parseAddress([]).ok).toBe(false);
  });

  test('formatAddress composes uuid@host correctly', async () => {
    const { formatAddress } = await import('../../src/lib/address.js');
    expect(formatAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6', 'bounty.example.com'))
      .toBe('ee0dd085-0b66-4640-81bc-f8d4c743c1e6@bounty.example.com');
  });

  test('isValidAddress returns true for valid uuid@host', async () => {
    const { isValidAddress } = await import('../../src/lib/address.js');
    expect(isValidAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6@bounty.example.com')).toBe(true);
  });

  test('isValidAddress returns false for bare UUID', async () => {
    const { isValidAddress } = await import('../../src/lib/address.js');
    expect(isValidAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6')).toBe(false);
  });

  test('accepts localhost host', async () => {
    const { parseAddress } = await import('../../src/lib/address.js');
    const r = parseAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6@localhost');
    expect(r.ok).toBe(true);
  });

  test('accepts sub.example.com host', async () => {
    const { parseAddress } = await import('../../src/lib/address.js');
    const r = parseAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6@sub.example.com');
    expect(r.ok).toBe(true);
  });

  test('accepts deep subdomain host', async () => {
    const { parseAddress } = await import('../../src/lib/address.js');
    const r = parseAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6@a.b.c.d.example.com');
    expect(r.ok).toBe(true);
  });

  test('accepts UUID v1 format', async () => {
    const { parseAddress } = await import('../../src/lib/address.js');
    const r = parseAddress('a8098c1a-f86e-515d-a32f-1c5b3d10f0a8@host.example.com');
    expect(r.ok).toBe(true);
  });

  test('accepts UUID v4 format (mixed case)', async () => {
    const { parseAddress } = await import('../../src/lib/address.js');
    const r = parseAddress('A8098C1A-F86E-515D-A32F-1C5B3D10F0A8@host.example.com');
    expect(r.ok).toBe(true);
  });

  test('REJECTS UUID v6+ (out of range)', async () => {
    const { parseAddress } = await import('../../src/lib/address.js');
    // 6th char "6" means v6 (RFC 4122 only has v1-v5)
    const r = parseAddress('a8098c1a-f86e-615d-a32f-1c5b3d10f0a8@host.example.com');
    expect(r.ok).toBe(false);
  });

  test('field name appears in error message', async () => {
    const { parseAddress } = await import('../../src/lib/address.js');
    const r = parseAddress('not-a-uuid', '--agent-address');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('--agent-address');
  });

  test('trims whitespace from valid uuid@host', async () => {
    const { parseAddress } = await import('../../src/lib/address.js');
    const r = parseAddress('  ee0dd085-0b66-4640-81bc-f8d4c743c1e6@bounty.example.com  ');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.uuid).toBe('ee0dd085-0b66-4640-81bc-f8d4c743c1e6');
    expect(r.value.host).toBe('bounty.example.com');
  });
});