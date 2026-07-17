import { describe, test, expect } from 'bun:test';

describe('profileNameSchema', () => {
  test('accepts lowercase alphanumeric + dash + underscore', async () => {
    const { profileNameSchema } = await import('../../../src/cli/config/schema.js');
    expect(profileNameSchema.safeParse('alice').success).toBe(true);
    expect(profileNameSchema.safeParse('alice-2').success).toBe(true);
    expect(profileNameSchema.safeParse('prod_us').success).toBe(true);
    expect(profileNameSchema.safeParse('a').success).toBe(true);
  });

  test('rejects empty / too long / uppercase / path traversal / dot', async () => {
    const { profileNameSchema } = await import('../../../src/cli/config/schema.js');
    expect(profileNameSchema.safeParse('').success).toBe(false);
    expect(profileNameSchema.safeParse('A'.repeat(65)).success).toBe(false);
    expect(profileNameSchema.safeParse('Alice').success).toBe(false);
    expect(profileNameSchema.safeParse('../etc').success).toBe(false);
    expect(profileNameSchema.safeParse('alice.bob').success).toBe(false);
    expect(profileNameSchema.safeParse('alice/bob').success).toBe(false);
  });
});

describe('bountyProfileSchema', () => {
  const validProfile = {
    name: 'alice',
    api_base: 'https://bounty.example.com',
    auth: { type: 'jwt' as const },
    created_at: 1700000000,
    updated_at: 1700000000,
  };

  test('accepts minimal valid profile', async () => {
    const { bountyProfileSchema } = await import('../../../src/cli/config/schema.js');
    expect(bountyProfileSchema.safeParse(validProfile).success).toBe(true);
  });

  test('accepts full profile with all optional fields', async () => {
    const { bountyProfileSchema } = await import('../../../src/cli/config/schema.js');
    const result = bountyProfileSchema.safeParse({
      ...validProfile,
      description: 'Alice agent',
      ws_base: 'wss://bounty.example.com/ws',
      agent_id: '8de9b6aa-5781-4a65-be96-45185fb7c8b1',
      agent_address: '8de9b6aa-5781-4a65-be96-45185fb7c8b1@bounty.local',
      email: 'alice@example.com',
      auth: {
        type: 'jwt',
        access_token: 'eyJhbGc...',
        refresh_token: null,
        expires_at: 1800000000,
        scope: ['agent:read', 'task:publish'],
      },
      tls_verify: true,
      default_scope: ['agent:*'],
      last_used_at: 1700000001,
    });
    expect(result.success).toBe(true);
  });

  test('rejects api_base without http(s) scheme', async () => {
    const { bountyProfileSchema } = await import('../../../src/cli/config/schema.js');
    expect(bountyProfileSchema.safeParse({ ...validProfile, api_base: 'ftp://bounty.example.com' }).success).toBe(false);
  });

  test('rejects invalid email', async () => {
    const { bountyProfileSchema } = await import('../../../src/cli/config/schema.js');
    expect(bountyProfileSchema.safeParse({ ...validProfile, email: 'not-an-email' }).success).toBe(false);
  });

  test('rejects auth.type != jwt', async () => {
    const { bountyProfileSchema } = await import('../../../src/cli/config/schema.js');
    expect(bountyProfileSchema.safeParse({ ...validProfile, auth: { type: 'oauth' } }).success).toBe(false);
  });
});

describe('bountyGlobalConfigSchema', () => {
  test('accepts minimal config', async () => {
    const { bountyGlobalConfigSchema } = await import('../../../src/cli/config/schema.js');
    expect(bountyGlobalConfigSchema.safeParse({ version: 1, active_profile: 'alice', schema_version: '0.11.0' }).success).toBe(true);
  });

  test('rejects wrong version', async () => {
    const { bountyGlobalConfigSchema } = await import('../../../src/cli/config/schema.js');
    expect(bountyGlobalConfigSchema.safeParse({ version: 2, active_profile: 'alice', schema_version: '0.11.0' }).success).toBe(false);
  });
});
