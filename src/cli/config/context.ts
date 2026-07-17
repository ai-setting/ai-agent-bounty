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

  /**
   * Return the active profile's `api_base`, or `undefined` if no profile is active.
   *
   * Unlike `requireActiveProfile()`, this does NOT throw when no profile exists,
   * so callers (e.g. `com/*` commands) can use it as a soft fallback before
   * resorting to `--host/--port` or `--server-url`.
   *
   * v0.13.1: Changed return type from `string` (throwing) to `string | undefined`
   * so `com/*` commands can read `profile.api_base` without forcing the user to
   * have an active profile (preserving `--host/--port` fallback for legacy flows).
   */
  getApiBase(): string | undefined {
    return activeProfile?.api_base || undefined;
  },
};

/** Compatibility alias for the design document's original name. */
export const BountyProfileContext = ProfileContext;
