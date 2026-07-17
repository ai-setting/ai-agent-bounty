import type { BountyProfile } from './types.js';

let activeProfile: BountyProfile | null = null;

export const ProfileContext = {
  setActive(profile: BountyProfile | null): void {
    activeProfile = profile;
  },

  getActive(): BountyProfile | null {
    return activeProfile;
  },

  clear(): void {
    activeProfile = null;
  },

  requireActiveProfile(): BountyProfile {
    if (!activeProfile) {
      throw new Error('No active profile context. Did the profile middleware run? (Or pass --profile <name>)');
    }
    return activeProfile;
  },

  getAccessToken(): string | undefined {
    return activeProfile?.auth.access_token || undefined;
  },

  getApiBase(): string {
    return this.requireActiveProfile().api_base;
  },
};

/** Compatibility alias for the design document's original name. */
export const BountyProfileContext = ProfileContext;
