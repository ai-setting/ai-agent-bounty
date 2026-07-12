/**
 * Tests for CLI address parser (v0.10+).
 *
 * v0.10 BREAKING: All CLI commands MUST use `--*-address` flags with
 * `<uuid>@<host>` format. Bare UUIDs are REJECTED. This file describes
 * the strict behavior after refactor.
 *
 * Layer tested:
 *   - parseAgentAddress (re-export from src/lib/address)
 */

import { describe, test, expect } from 'bun:test';

describe('agent address parser (v0.10 strict)', () => {
  test('extracts uuid/local and host from uuid@host address', async () => {
    const { parseAgentAddress } = await import('../../src/cli/lib/address-parser.js');
    const parsed = parseAgentAddress(
      'ee0dd085-0b66-4640-81bc-f8d4c743c1e6@bounty.tongagents.example.com',
      '--publisher-address'
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.uuid).toBe('ee0dd085-0b66-4640-81bc-f8d4c743c1e6');
    expect(parsed.value.host).toBe('bounty.tongagents.example.com');
  });

  test('REJECTS bare UUID — BREAKING in v0.10', async () => {
    const { parseAgentAddress } = await import('../../src/cli/lib/address-parser.js');
    const parsed = parseAgentAddress(
      'ee0dd085-0b66-4640-81bc-f8d4c743c1e6',
      '--agent-address'
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    // Bare UUID should produce a uuid@host required error
    expect(parsed.error).toContain('<uuid>@<host>');
    expect(parsed.error).toContain('--agent-address');
  });

  test('trims whitespace before parsing strict uuid@host', async () => {
    const { parseAgentAddress } = await import('../../src/cli/lib/address-parser.js');
    const parsed = parseAgentAddress('  ee0dd085-0b66-4640-81bc-f8d4c743c1e6@host.test  ', '--agent-address');

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.uuid).toBe('ee0dd085-0b66-4640-81bc-f8d4c743c1e6');
    expect(parsed.value.host).toBe('host.test');
  });

  test('rejects missing local part with helpful error', async () => {
    const { parseAgentAddress } = await import('../../src/cli/lib/address-parser.js');
    const parsed = parseAgentAddress('@host.test', '--agent-address');

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('--agent-address');
    expect(parsed.error).toContain('missing uuid before');
  });

  test('rejects missing host part with helpful error', async () => {
    const { parseAgentAddress } = await import('../../src/cli/lib/address-parser.js');
    const parsed = parseAgentAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6@', '--agent-address');

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('--agent-address');
    expect(parsed.error).toContain('missing host after');
  });

  test('rejects multiple @ signs with friendly error', async () => {
    const { parseAgentAddress } = await import('../../src/cli/lib/address-parser.js');
    const parsed = parseAgentAddress('abc@host@extra', '--agent-address');

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('multiple');
    expect(parsed.error).toContain('@');
  });

  test('rejects email-like input (uuid part must be valid UUID)', async () => {
    const { parseAgentAddress } = await import('../../src/cli/lib/address-parser.js');
    const parsed = parseAgentAddress('user@example.com', '--agent-address');

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/uuid/i);
  });

  test('rejects empty string', async () => {
    const { parseAgentAddress } = await import('../../src/cli/lib/address-parser.js');
    const parsed = parseAgentAddress('', '--agent-address');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('empty');
  });

  test('rejects non-string (number)', async () => {
    const { parseAgentAddress } = await import('../../src/cli/lib/address-parser.js');
    const parsed = parseAgentAddress(123 as any, '--agent-address');
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toContain('must be a string');
  });
});

describe('resolveAddressOption — unified helper (v0.10)', () => {
  test('returns full { uuid, host } when explicit address flag has full uuid@host', async () => {
    const { resolveAddressOption } = await import('../../src/cli/lib/address-parser.js');
    const r = resolveAddressOption({
      address: 'ee0dd085-0b66-4640-81bc-f8d4c743c1e6@bounty.example.com',
      addressFlag: '--agent-address',
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.uuid).toBe('ee0dd085-0b66-4640-81bc-f8d4c743c1e6');
    expect(r.value.host).toBe('bounty.example.com');
    expect(r.value.raw).toBe('ee0dd085-0b66-4640-81bc-f8d4c743c1e6@bounty.example.com');
  });

  test('uses fallback (BOUNTY_IM_ADDRESS) when no explicit flag set', async () => {
    const { resolveAddressOption } = await import('../../src/cli/lib/address-parser.js');
    const r = resolveAddressOption({
      address: undefined,
      fallback: 'ee0dd085-0b66-4640-81bc-f8d4c743c1e6@bounty.example.com',
      addressFlag: '--agent-address',
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.uuid).toBe('ee0dd085-0b66-4640-81bc-f8d4c743c1e6');
    expect(r.value.host).toBe('bounty.example.com');
  });

  test('returns clear error when nothing available and no fallback', async () => {
    const { resolveAddressOption } = await import('../../src/cli/lib/address-parser.js');
    const r = resolveAddressOption({
      address: undefined,
      addressFlag: '--agent-address',
      missingMessage: 'Cannot infer agent address',
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('Cannot infer agent address');
    expect(r.error).toContain('--agent-address');
  });

  test('explicit address flag wins over fallback', async () => {
    const { resolveAddressOption } = await import('../../src/cli/lib/address-parser.js');
    const r = resolveAddressOption({
      address: 'ee0dd085-0b66-4640-81bc-f8d4c743c1e6@explicit.host',
      fallback: 'ee0dd085-aaaa-bbbb-cccc-f8d4c743c1e6@fallback.host',
      addressFlag: '--publisher-address',
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.uuid).toBe('ee0dd085-0b66-4640-81bc-f8d4c743c1e6');
    expect(r.value.host).toBe('explicit.host');
  });

  test('REJECTS bare UUID in address flag — BREAKING', async () => {
    const { resolveAddressOption } = await import('../../src/cli/lib/address-parser.js');
    const r = resolveAddressOption({
      address: 'bare-uuid-no-host',
      addressFlag: '--agent-address',
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('<uuid>@<host>');
  });

  test('REJECTS bare UUID in fallback (BOUNTY_IM_ADDRESS) — BREAKING', async () => {
    const { resolveAddressOption } = await import('../../src/cli/lib/address-parser.js');
    const r = resolveAddressOption({
      address: undefined,
      fallback: 'bare-uuid-no-host',
      addressFlag: '--agent-address',
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain('<uuid>@<host>');
    expect(r.error).toMatch(/BOUNTY_IM_ADDRESS|<uuid>@<host>/);
  });
});
