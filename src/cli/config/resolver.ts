/** Resolve the active profile through CLI, environment, config, then default. */
import { DEFAULT_PROFILE_NAME } from './paths.js';
import { listProfiles, loadProfile, readGlobalConfig } from './store.js';
import type { ResolvedProfile } from './types.js';

export interface ResolverOptions {
  profilesDir?: string;
  configFile?: string;
  /** Dependency injection for callers/tests; defaults to process.env.BOUNTY_PROFILE. */
  envProfile?: string;
}

export function resolveActiveProfile(
  cliProfileArg: string | null | undefined,
  opts: ResolverOptions = {},
): ResolvedProfile {
  const storeOptions = { profilesDir: opts.profilesDir };
  const available = listProfiles(storeOptions);
  const explicitCli = typeof cliProfileArg === 'string' && cliProfileArg.trim().length > 0;
  const envCandidate = opts.envProfile ?? process.env.BOUNTY_PROFILE;
  const explicitEnv = typeof envCandidate === 'string' && envCandidate.trim().length > 0;

  let name: string;
  let source: ResolvedProfile['source'];
  if (explicitCli) {
    name = cliProfileArg!.trim();
    source = 'cli';
  } else if (explicitEnv) {
    name = envCandidate!.trim();
    source = 'env';
  } else {
    const config = readGlobalConfig({ configFile: opts.configFile });
    if (config?.active_profile) {
      name = config.active_profile;
      source = 'config';
    } else {
      name = DEFAULT_PROFILE_NAME;
      source = 'default';
    }
  }

  const profile = loadProfile(name, storeOptions);
  return {
    name,
    profile,
    exists: profile !== null,
    available,
    source,
  };
}

export class ProfileResolver {
  constructor(private readonly opts: ResolverOptions = {}) {}

  resolve(cliProfileArg: string | null | undefined): ResolvedProfile {
    return resolveActiveProfile(cliProfileArg, this.opts);
  }
}
