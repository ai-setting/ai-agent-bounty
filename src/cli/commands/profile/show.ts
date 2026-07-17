/**
 * bounty profile show [--name]
 *
 * PR2: Display a profile (defaulting to the active one). Sensitive fields
 * (`access_token`, `refresh_token`) are redacted to a tail so the user can
 * still recognize the token without leaking the secret.
 *
 * Token format: `***<last4>` of the original token. If the token is missing,
 * the field reads "(not set)".
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { profileNameSchema } from '../../config/schema.js';
import { profilePath } from '../../config/paths.js';
import {
  loadProfile,
  type StoreOptions,
} from '../../config/store.js';
import { resolveActiveProfile } from '../../config/resolver.js';
import type { BountyProfile } from '../../config/types.js';

interface ShowOptions {
  name?: string;
  json?: boolean;
}

function buildStoreOptions(argv: Record<string, unknown>): StoreOptions {
  const raw = argv.__storeOptions;
  if (raw && typeof raw === 'object') return raw as StoreOptions;
  return {};
}

function exitWith(code: number, message: string): never {
  console.error(chalk.red(`\n✗ ${message}\n`));
  process.exit(code);
}

function redact(token: string | undefined | null): string {
  if (!token || token.length === 0) return '(not set)';
  const tail = token.slice(-4);
  return `***${tail}`;
}

function redactProfile(profile: BountyProfile): Record<string, unknown> {
  return {
    name: profile.name,
    description: profile.description,
    api_base: profile.api_base,
    ws_base: profile.ws_base,
    agent_id: profile.agent_id,
    agent_address: profile.agent_address,
    email: profile.email,
    tls_verify: profile.tls_verify,
    default_scope: profile.default_scope,
    auth: {
      type: profile.auth.type,
      access_token: redact(profile.auth.access_token),
      refresh_token: redact(profile.auth.refresh_token ?? undefined),
      expires_at: profile.auth.expires_at,
      scope: profile.auth.scope ?? [],
    },
    created_at: profile.created_at,
    updated_at: profile.updated_at,
    last_used_at: profile.last_used_at,
  };
}

function formatHuman(redacted: Record<string, unknown>, filePath: string): string {
  const lines: string[] = [];
  const auth = redacted.auth as Record<string, unknown>;
  lines.push(chalk.bold(`Profile: ${redacted.name}`));
  lines.push(chalk.gray(`File:    ${filePath}`));
  lines.push(`  api_base:   ${redacted.api_base}`);
  if (redacted.ws_base) lines.push(`  ws_base:    ${redacted.ws_base}`);
  lines.push(`  agent_id:   ${redacted.agent_id ?? '(not set)'}`);
  if (redacted.agent_address) lines.push(`  address:    ${redacted.agent_address}`);
  lines.push(`  email:      ${redacted.email ?? '(not set)'}`);
  lines.push(`  tls_verify: ${redacted.tls_verify ?? true}`);
  if (redacted.default_scope && (redacted.default_scope as string[]).length > 0) {
    lines.push(`  default_scope: ${(redacted.default_scope as string[]).join(', ')}`);
  }
  lines.push(`  auth.type:   ${auth.type}`);
  lines.push(`  auth.token:  ${auth.access_token}`);
  if (auth.refresh_token !== '(not set)') lines.push(`  auth.refresh: ${auth.refresh_token}`);
  if (auth.expires_at) {
    lines.push(`  auth.expires_at: ${new Date((auth.expires_at as number) * 1000).toISOString()}`);
  }
  if (auth.scope && (auth.scope as string[]).length > 0) {
    lines.push(`  auth.scope:  ${(auth.scope as string[]).join(', ')}`);
  }
  if (redacted.created_at) {
    lines.push(`  created_at:  ${new Date((redacted.created_at as number) * 1000).toISOString()}`);
  }
  if (redacted.updated_at) {
    lines.push(`  updated_at:  ${new Date((redacted.updated_at as number) * 1000).toISOString()}`);
  }
  if (redacted.last_used_at) {
    lines.push(`  last_used_at: ${new Date((redacted.last_used_at as number) * 1000).toISOString()}`);
  }
  return lines.join('\n');
}

export const showCommand: CommandModule<object, ShowOptions> = {
  command: 'show',
  describe: 'Show a profile (default: the active one)',
  builder: (yargs) =>
    yargs
      .option('name', {
        type: 'string',
        description: 'Profile name (defaults to the active profile)',
      })
      .option('json', {
        type: 'boolean',
        default: false,
        description: 'Emit JSON (tokens still redacted)',
      }),

  handler: async (argv) => {
    const opts = buildStoreOptions(argv as Record<string, unknown>);

    let name: string;
    if (typeof argv.name === 'string' && argv.name.trim().length > 0) {
      name = argv.name.trim();
    } else {
      const resolved = resolveActiveProfile(null, opts);
      name = resolved.name;
    }

    if (!profileNameSchema.safeParse(name).success) {
      exitWith(1, `Invalid profile name "${name}".`);
    }

    const profile = loadProfile(name, opts);
    if (!profile) {
      exitWith(
        1,
        `Profile "${name}" not found.\n  Run \`bounty profile add ${name} --api-base <url> --token <jwt>\` to create it.`,
      );
    }

    const redacted = redactProfile(profile);

    if (argv.json) {
      console.log(JSON.stringify(redacted, null, 2));
      return;
    }
    console.log('\n' + formatHuman(redacted, profilePath(name)) + '\n');
  },
};

export default showCommand;
