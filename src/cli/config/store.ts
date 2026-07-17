/** Profile JSON and global config storage. Linux/macOS only. */
import {
  readdirSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  renameSync,
  unlinkSync,
} from 'fs';
import { dirname, join } from 'path';
import {
  BOUNTY_CONFIG_FILE,
  BOUNTY_PROFILES_DIR,
} from './paths.js';
import {
  bountyGlobalConfigSchema,
  bountyProfileSchema,
  profileNameSchema,
} from './schema.js';
import type { BountyGlobalConfig, BountyProfile } from './types.js';

export interface StoreOptions {
  profilesDir?: string;
  configFile?: string;
}

function profilesDirectory(opts: StoreOptions): string {
  return opts.profilesDir ?? BOUNTY_PROFILES_DIR;
}

function configPath(opts: StoreOptions): string {
  return opts.configFile ?? BOUNTY_CONFIG_FILE;
}

function safeProfileName(name: string): boolean {
  return profileNameSchema.safeParse(name).success;
}

function writeAtomically(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tempFile = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    writeFileSync(tempFile, content, 'utf8');
    renameSync(tempFile, file);
  } catch (error) {
    try { unlinkSync(tempFile); } catch { /* best effort cleanup */ }
    throw error;
  }
}

export function listProfiles(opts: StoreOptions = {}): string[] {
  try {
    return readdirSync(profilesDirectory(opts), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name.slice(0, -'.json'.length))
      .filter(safeProfileName)
      .sort();
  } catch {
    return [];
  }
}

export function loadProfile(name: string, opts: StoreOptions = {}): BountyProfile | null {
  if (!safeProfileName(name)) return null;
  try {
    const raw = readFileSync(join(profilesDirectory(opts), `${name}.json`), 'utf8');
    const result = bountyProfileSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function saveProfile(profile: BountyProfile, opts: StoreOptions = {}): void {
  const result = bountyProfileSchema.safeParse(profile);
  if (!result.success) {
    throw new Error(`Invalid profile: ${result.error.message}`);
  }
  writeAtomically(join(profilesDirectory(opts), `${profile.name}.json`), JSON.stringify(result.data, null, 2));
}

export function deleteProfile(name: string, opts: StoreOptions = {}): void {
  if (!safeProfileName(name)) return;
  try {
    rmSync(join(profilesDirectory(opts), `${name}.json`));
  } catch {
    // Deleting a missing profile is intentionally idempotent.
  }
}

export function readGlobalConfig(opts: StoreOptions = {}): BountyGlobalConfig | null {
  try {
    const result = bountyGlobalConfigSchema.safeParse(JSON.parse(readFileSync(configPath(opts), 'utf8')));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function writeGlobalConfig(config: BountyGlobalConfig, opts: StoreOptions = {}): void {
  const result = bountyGlobalConfigSchema.safeParse(config);
  if (!result.success) {
    throw new Error(`Invalid global config: ${result.error.message}`);
  }
  writeAtomically(configPath(opts), JSON.stringify(result.data, null, 2));
}

/** Aliases used by callers that treat config as a store resource. */
export const readConfig = readGlobalConfig;
export const writeConfig = writeGlobalConfig;

export function updateLastUsed(name: string, opts: StoreOptions = {}): void {
  const profile = loadProfile(name, opts);
  if (!profile) return;
  const now = Math.floor(Date.now() / 1000);
  profile.last_used_at = now;
  profile.updated_at = now;
  saveProfile(profile, opts);
}

/** Stateful facade for consumers that prefer an object-oriented manager. */
export class ProfileManager {
  constructor(private readonly opts: StoreOptions = {}) {}

  listProfiles(): string[] { return listProfiles(this.opts); }
  loadProfile(name: string): BountyProfile | null { return loadProfile(name, this.opts); }
  saveProfile(profile: BountyProfile): void { saveProfile(profile, this.opts); }
  deleteProfile(name: string): void { deleteProfile(name, this.opts); }
  readConfig(): BountyGlobalConfig | null { return readGlobalConfig(this.opts); }
  writeConfig(config: BountyGlobalConfig): void { writeGlobalConfig(config, this.opts); }
  updateLastUsed(name: string): void { updateLastUsed(name, this.opts); }
}
