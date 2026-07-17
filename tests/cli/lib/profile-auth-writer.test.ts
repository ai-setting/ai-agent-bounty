import { describe, test, expect } from 'bun:test';
import { writeAuthToProfile } from '../../../src/cli/lib/profile-auth-writer.js';
import type { BountyProfile } from '../../../src/cli/config/types.js';

function profileFixture(): BountyProfile {
  return {
    name: 'prod',
    api_base: 'https://bounty.example.com',
    auth: { type: 'jwt' },
    created_at: 1,
    updated_at: 1,
  };
}

describe('writeAuthToProfile', () => {
  test('writes access_token + refresh_token + expires_at into the persisted profile', () => {
    const store = new Map<string, BountyProfile>();
    const original = profileFixture();
    store.set('prod', { ...original });

    const result = writeAuthToProfile({
      profile: original,
      accessToken: 'jwt-1',
      refreshToken: 'refresh-1',
      expiresAt: 1_700_000_000,
      agentId: '11111111-2222-3333-4444-555555555555',
      email: 'alice@example.com',
      loadProfileFn: (name) => store.get(name) ?? null,
      saveProfileFn: (p) => store.set(p.name, p),
    });

    expect(result).toEqual({ wroteProfile: true, profileName: 'prod' });
    const saved = store.get('prod');
    expect(saved?.auth.access_token).toBe('jwt-1');
    expect(saved?.auth.refresh_token).toBe('refresh-1');
    expect(saved?.auth.expires_at).toBe(1_700_000_000);
    expect(saved?.agent_id).toBe('11111111-2222-3333-4444-555555555555');
    expect(saved?.email).toBe('alice@example.com');
    expect((saved?.updated_at ?? 0) > 0).toBe(true);
  });

  test('preserves existing refresh_token when caller omits it', () => {
    const store = new Map<string, BountyProfile>();
    store.set('prod', { ...profileFixture(), auth: { type: 'jwt', refresh_token: 'keep-me' } });
    writeAuthToProfile({
      profile: store.get('prod')!,
      accessToken: 'jwt-2',
      loadProfileFn: (name) => store.get(name) ?? null,
      saveProfileFn: (p) => store.set(p.name, p),
    });
    expect(store.get('prod')?.auth.refresh_token).toBe('keep-me');
  });

  test('returns wroteProfile=false without touching the disk when no profile is active', () => {
    const writes: BountyProfile[] = [];
    const result = writeAuthToProfile({
      profile: null,
      accessToken: 'jwt-x',
      saveProfileFn: (p) => writes.push(p),
    });
    expect(result).toEqual({ wroteProfile: false });
    expect(writes).toHaveLength(0);
  });

  test('throws when accessToken is empty', () => {
    expect(() =>
      writeAuthToProfile({
        profile: profileFixture(),
        accessToken: '',
      }),
    ).toThrow(/accessToken/);
  });
});