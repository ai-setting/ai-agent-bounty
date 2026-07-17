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
 * delete the file via `unlinkSync` directly and surface any non-ENOENT
 * IO failure as a clear error.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import {
  existsSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  loadProfile,
  type StoreOptions,
} from '../../config/store.js';
import { BOUNTY_PROFILES_DIR } from '../../config/paths.js';
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

    // Refuse to remove the effective active profile (resolver-driven,
    // honouring global --profile/-P override).
    const cliProfile = typeof args.profile === 'string' && args.profile.trim().length > 0
      ? args.profile.trim()
      : null;
    const resolved = resolveActiveProfile(cliProfile, opts);
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

    // Compute the destination path; bail with a clear message if the user
    // has no __storeOptions seam AND the file lives under the default
    // profiles directory (still safe — we know exactly where to look).
    const dir = opts.profilesDir ?? BOUNTY_PROFILES_DIR;
    const file = join(dir, `${name}.json`);
    if (!existsSync(file)) {
      exitWith(1, `Profile "${name}" disappeared during confirmation. Aborted.`);
    }

    // Defect 3 fix: bypass PR1's idempotent `deleteProfile` (which swallows
    // every rmSync failure). unlinkSync throws on real IO errors so we can
    // surface them. ENOENT is treated as already-gone (idempotent remove).
    try {
      unlinkSync(file);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') {
        exitWith(
          1,
          `Failed to remove profile "${name}": ` +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }

    console.log(chalk.green(`\n✓ Profile "${name}" removed.\n`));
  },
};

export default removeCommand;
