import { describe, test, expect } from 'bun:test';

describe('agent address parser', () => {
  test('extracts uuid/local part from uuid@host address', async () => {
    const { parseAgentAddress } = await import('../../src/cli/lib/address-parser.js');
    const parsed = parseAgentAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6@bounty.tongagents.example.com', '--publisher-address');

    expect(parsed.ok).toBe(true);
    expect(parsed.value.uuid).toBe('ee0dd085-0b66-4640-81bc-f8d4c743c1e6');
    expect(parsed.value.host).toBe('bounty.tongagents.example.com');
  });

  test('accepts pure uuid/local id for backward compatibility', async () => {
    const { parseAgentAddress } = await import('../../src/cli/lib/address-parser.js');
    const parsed = parseAgentAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6', '--agent-address');

    expect(parsed.ok).toBe(true);
    expect(parsed.value.uuid).toBe('ee0dd085-0b66-4640-81bc-f8d4c743c1e6');
    expect(parsed.value.host).toBeUndefined();
  });

  test('trims whitespace before parsing', async () => {
    const { parseAgentAddress } = await import('../../src/cli/lib/address-parser.js');
    const parsed = parseAgentAddress('  abc-123@host.test  ', '--agent-address');

    expect(parsed.ok).toBe(true);
    expect(parsed.value.uuid).toBe('abc-123');
    expect(parsed.value.host).toBe('host.test');
  });

  test('rejects missing local part', async () => {
    const { parseAgentAddress } = await import('../../src/cli/lib/address-parser.js');
    const parsed = parseAgentAddress('@host.test', '--agent-address');

    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('--agent-address');
    expect(parsed.error).toContain('missing agent id before @');
  });

  test('rejects missing host part', async () => {
    const { parseAgentAddress } = await import('../../src/cli/lib/address-parser.js');
    const parsed = parseAgentAddress('abc-123@', '--agent-address');

    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('--agent-address');
    expect(parsed.error).toContain('missing host after @');
  });

  test('rejects multiple @ signs with friendly error', async () => {
    const { parseAgentAddress } = await import('../../src/cli/lib/address-parser.js');
    const parsed = parseAgentAddress('abc@host@extra', '--agent-address');

    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('must be <uuid>@<host> or <uuid>');
  });

  test('resolveAgentIdOption prefers address over deprecated id and does not warn', async () => {
    const { resolveAgentIdOption } = await import('../../src/cli/lib/address-parser.js');
    const warnings: string[] = [];

    const resolved = resolveAgentIdOption({
      address: 'new-agent@host',
      deprecatedId: 'old-agent',
      addressFlag: '--agent-address',
      deprecatedFlag: '--agent-id',
      warn: (msg) => warnings.push(msg),
    });

    expect(resolved.ok).toBe(true);
    expect(resolved.value).toBe('new-agent');
    expect(warnings).toHaveLength(0);
  });

  test('resolveAgentIdOption accepts deprecated id alias and warns once', async () => {
    const { resolveAgentIdOption } = await import('../../src/cli/lib/address-parser.js');
    const warnings: string[] = [];

    const resolved = resolveAgentIdOption({
      deprecatedId: 'legacy-agent',
      addressFlag: '--agent-address',
      deprecatedFlag: '--agent-id',
      warn: (msg) => warnings.push(msg),
    });

    expect(resolved.ok).toBe(true);
    expect(resolved.value).toBe('legacy-agent');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('--agent-id is deprecated');
    expect(warnings[0]).toContain('--agent-address');
  });
});
