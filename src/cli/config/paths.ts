/** XDG Base Directory profile storage paths (Linux/macOS). */
import { homedir } from 'os';
import { join } from 'path';

export const BOUNTY_CONFIG_DIR = join(homedir(), '.config', 'bounty');
export const BOUNTY_CONFIG_FILE = join(BOUNTY_CONFIG_DIR, 'config.json');
export const BOUNTY_PROFILES_DIR = join(BOUNTY_CONFIG_DIR, 'profiles');
export const DEFAULT_PROFILE_NAME = 'default';

export function profilePath(name: string): string {
  return join(BOUNTY_PROFILES_DIR, `${name}.json`);
}
