/**
 * bounty profile add <name> [options]
 *
 * PR2: Create a new profile in `~/.config/bounty/profiles/<name>.json`.
 *
 * Reuses PR1 store (`saveProfile`) for atomic file writes; name and api_base
 * are validated by the existing Zod schemas in `config/schema.ts`. The handler
 * honours a private `__storeOptions` seam so tests can point at a temp
 * directory; this key is filtered out before forwarding (yargs already
 * ignores unknown keys so no extra plumbing is needed).
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { existsSync } from 'fs';
import { join } from 'path';
import { API_BASE } from '../../config.js';
import { profileNameSchema } from '../../config/schema.js';
import {
  profilePath,
  BOUNTY_PROFILES_DIR,
} from '../../config/paths.js';
import { saveProfile, type StoreOptions } from '../../config/store.js';
import type { BountyProfile } from '../../config/types.js';

interface AddOptions {
  name?: string;
  'api-base'?: string;
  token?: string;
  'agent-id'?: string;
  email?: string;
}

function exitWith(code: number, message: string): never {
  console.error(chalk.red(`\n✗ ${message}\n`));
  process.exit(code);
}

function buildStoreOptions(argv: Record<string, unknown>): StoreOptions {
  const raw = argv.__storeOptions;
  if (raw && typeof raw === 'object') {
    return raw as StoreOptions;
  }
  return {};
}

function resolveApiBase(value: string | undefined): string {
  const candidate = value && value.trim().length > 0 ? value.trim() : API_BASE;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`api_base must be a valid URL (received: ${value ?? '(empty)'})`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`api_base must start with http:// or https:// (received: ${candidate})`);
  }
  return candidate.replace(/\/+$/, '');
}

function validateUuid(value: string, flag: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`${flag} must be a valid UUID (received: ${value})`);
  }
}

function validateEmail(value: string, flag: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error(`${flag} must be a valid email address (received: ${value})`);
  }
}

export const addCommand: CommandModule<object, AddOptions> = {
  command: 'add <name>',
  describe: 'Create a new profile',
  builder: (yargs) =>
    yargs
      .positional('name', {
        type: 'string',
        description: 'Profile name (lowercase letters, digits, dash, underscore)',
        demandOption: true,
      })
      .option('api-base', {
        type: 'string',
        description: 'API base URL (e.g. https://api.example.com)',
      })
      .option('token', {
        type: 'string',
        description: 'JWT access token (run `bounty auth login` first if omitted)',
      })
      .option('agent-id', {
        type: 'string',
        description: 'Agent UUID bound to this profile',
      })
      .option('email', {
        type: 'string',
        description: 'Agent email bound to this profile',
      }),

  handler: async (argv) => {
    const opts = buildStoreOptions(argv as Record<string, unknown>);
    const name = typeof argv.name === 'string' ? argv.name.trim() : '';
    if (!name) exitWith(1, 'Profile name is required.');

    const nameResult = profileNameSchema.safeParse(name);
    if (!nameResult.success) {
      exitWith(
        1,
        `Invalid profile name "${name}": ${nameResult.error.issues.map((i) => i.message).join('; ')}`,
      );
    }

    const profilesDir = opts.profilesDir ?? BOUNTY_PROFILES_DIR;
    const onDisk = join(profilesDir, `${name}.json`);
    if (existsSync(onDisk)) {
      exitWith(
        1,
        `Profile "${name}" already exists at ${onDisk}.\n  Run \`bounty profile use ${name}\` to activate it, or \`bounty profile remove ${name}\` to delete.`,
      );
    }

    let apiBase: string;
    try {
      apiBase = resolveApiBase(argv['api-base']);
    } catch (err) {
      exitWith(1, err instanceof Error ? err.message : String(err));
    }

    if (argv['agent-id']) validateUuid(argv['agent-id'], '--agent-id');
    if (argv.email) validateEmail(argv.email, '--email');

    const now = Math.floor(Date.now() / 1000);
    const profile: BountyProfile = {
      name,
      api_base: apiBase,
      auth: { type: 'jwt' },
      created_at: now,
      updated_at: now,
    };
    if (argv.token) profile.auth.access_token = argv.token;
    if (argv['agent-id']) profile.agent_id = argv['agent-id'];
    if (argv.email) profile.email = argv.email;

    try {
      saveProfile(profile, opts);
    } catch (err) {
      exitWith(1, err instanceof Error ? err.message : String(err));
    }

    console.log(chalk.green(`\n✓ Profile "${name}" created at ${profilePath(name)}`));
    if (!argv.token) {
      console.log(
        chalk.yellow(
          `\n  ⚠ No --token supplied. Run \`bounty auth login\` to populate the access token, or re-run with --token <jwt>.`,
        ),
      );
    }
    console.log(chalk.cyan(`\n  Activate with: bounty profile use ${name}`));
  },
};

export default addCommand;
