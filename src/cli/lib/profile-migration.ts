/**
 * Legacy token → profile migration helper.
 *
 * PR3 motivation: pre-PR1 deployments stored their auth token in
 * `~/.config/bounty/token`. After PR1 all CLI commands read tokens from
 * `ProfileContext`. To keep existing users logged in without re-running
 * `bounty auth login`, this helper detects the legacy file and copies the
 * token into the default profile (without deleting the original file —
 * `readAuthToken` keeps using it as a fallback until the user re-runs
 * `bounty auth login` against the new profile).
 *
 * Contract:
 *   migrateLegacyToken({ tokenPath, profilesDir, configFile, log }) → {
 *     migrated: boolean,
 *     profileName?: string,
 *   }
 *
 * - When the legacy file is missing or empty: returns `{ migrated: false }` and
 *   emits no log entries.
 * - When a default profile already exists with its own `access_token`: leaves
 *   it untouched, returns `{ migrated: false }`, and emits a "skipped" log.
 * - Otherwise writes the token into a freshly minted default profile that uses
 *   `http://localhost:4000` as the api_base (kept conservative so users can
 *   still override it later via `bounty profile use` or `profile add`).
 *
 * Linux/macOS only — same constraint as the rest of the profile subsystem.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { saveProfile } from '../config/store.js';
import { bountyProfileSchema } from '../config/schema.js';
import type { BountyProfile } from '../config/types.js';

export interface MigrateOptions {
  tokenPath: string;
  profilesDir: string;
  configFile: string;
  log?: (message: string) => void;
}

export interface MigrateResult {
  migrated: boolean;
  profileName?: string;
}

const DEFAULT_API_BASE = 'http://localhost:4000';

function emit(log: ((message: string) => void) | undefined, message: string): void {
  if (log) log(message);
}

export function migrateLegacyToken(options: MigrateOptions): MigrateResult {
  const { tokenPath, profilesDir, log } = options;
  if (!existsSync(tokenPath)) {
    return { migrated: false };
  }

  let raw: string;
  try {
    raw = readFileSync(tokenPath, 'utf8');
  } catch {
    return { migrated: false };
  }
  const token = raw.trim();
  if (!token) {
    return { migrated: false };
  }

  const target = join(profilesDir, 'default.json');
  if (existsSync(target)) {
    try {
      const existing = JSON.parse(readFileSync(target, 'utf8'));
      const result = bountyProfileSchema.safeParse(existing);
      if (result.success && result.data.auth.access_token && result.data.auth.access_token.length > 0) {
        emit(log, `[profile-migration] default profile already has a token; skipping migration`);
        return { migrated: false };
      }
    } catch {
      // Corrupted default profile — fall through and overwrite.
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const profile: BountyProfile = {
    name: 'default',
    api_base: DEFAULT_API_BASE,
    auth: { type: 'jwt', access_token: token },
    created_at: now,
    updated_at: now,
  };
  saveProfile(profile, { profilesDir });

  emit(
    log,
    `[profile-migration] Migrated legacy token from ${tokenPath} → profiles/default.json`,
  );
  return { migrated: true, profileName: 'default' };
}