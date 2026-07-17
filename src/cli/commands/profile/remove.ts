/**
 * bounty profile remove <name> [--force]
 *
 * PR2: Delete a profile file. Refuses to remove the effective active profile
 * (the user must switch with `bounty profile use` first). Without `--force`,
 * the handler asks for confirmation via `argv.__confirm?: () => Promise<boolean>`
 * (test seam). When the seam is absent, the handler falls back to a Node
 * readline prompt: `Are you sure? (y/N)`.
 *
 * The PR1 `deleteProfile` is intentionally idempotent (it swallows
 * `ENOENT`); for a user-visible command we want explicit errors, so we
 * pre-check existence and surface any other IO failure.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import {
  existsSync,
} from 'fs';
import { join } from 'path';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  loadProfile,
  deleteProfile,
  type StoreOptions,
} from '../../config/store.js';
import { profileNameSchema } from '../../config/schema.js';
import { resolveActiveProfile } from '../../config/resolver.js';

interface RemoveOptions {
  name?: string;
  force?: boolean;
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

type Confirm = () => Promise<boolean>;

function readConfirm(argv: Record<string, unknown>): Confirm | undefined {
  const raw = argv.__confirm;
  if (typeof raw === 'function') {
    return raw as Confirm;
  }
  return undefined;
}

async function promptForConfirm(): Promise<boolean> {
  try {
    const rl = readline.createInterface({ input, output });
    const answer = await rl.question(chalk.yellow('Are you sure you want to remove this profile? (y/N) '));
    rl.close();
    const v = answer.trim().toLowerCase();
    return v === 'y' || v === 'yes';
  } catch {
    // readline failure (e.g., non-TTY stdin) — refuse to delete.
    return false;
  }
}

export const removeCommand: CommandModule<object, RemoveOptions> = {
  command: 'remove <name>',
  aliases: ['rm', 'delete'],
  describe: 'Remove a profile (will not remove the active one)',
  builder: (yargs) =>
    yargs
      .positional('name', {
        type: 'string',
        description: 'Profile name to remove',
        demandOption: true,
      })
      .option('force', {
        type: 'boolean',
        default: false,
        description: 'Skip confirmation prompt',
      }),

  handler: async (argv) => {
    const args = argv as Record<string, unknown>;
    const opts = buildStoreOptions(args);

    const rawName = argv.name;
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!name || !profileNameSchema.safeParse(name).success) {
      exitWith(1, `Invalid profile name "${name}".`);
    }

    // Existence pre-check: PR1 store swallows ENOENT, so we surface it here.
    const profile = loadProfile(name, opts);
    if (!profile) {
      exitWith(1, `Profile "${name}" not found.\n  Run \`bounty profile list\` to see available profiles.`);
    }

    // Refuse to remove the effective active profile (resolver-driven).
    const resolved = resolveActiveProfile(null, opts);
    if (resolved.exists && resolved.name === name) {
      exitWith(
        1,
        `Profile "${name}" is the currently active profile.\n` +
          `  Switch first with \`bounty profile use <other>\`, then try again.`,
      );
    }

    if (!args.force) {
      const injected = readConfirm(args);
      const confirm = injected ?? promptForConfirm;
      const ok = await confirm();
      if (!ok) {
        console.log(chalk.yellow('\nAborted. Profile not removed.\n'));
        return;
      }
    }

    // Existence check before delete so we never silently lose a profile to a
    // race (and so we can render a precise error message).
    const profilesDir = opts.profilesDir ?? '';
    const file = profilesDir ? join(profilesDir, `${name}.json`) : null;
    if (file && !existsSync(file)) {
      exitWith(1, `Profile "${name}" disappeared during confirmation. Aborted.`);
    }

    deleteProfile(name, opts);
    console.log(chalk.green(`\n✓ Profile "${name}" removed.\n`));
  },
};

export default removeCommand;
