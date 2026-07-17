/**
 * bounty profile rename <old> <new>
 *
 * PR2: Atomically move a profile file from `<old>.json` to `<new>.json`,
 * updating the inner `name` field. If the renamed profile is the active one,
 * synchronously update `config.active_profile` (preserving version + schema).
 *
 * Reuses PR1 store (`loadProfile`, `saveProfile`, `deleteProfile`, `readGlobalConfig`,
 * `writeGlobalConfig`). Validation is delegated to `profileNameSchema`. The
 * `__storeOptions` seam keeps test isolation tight without exposing it to the
 * CLI surface.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import {
  loadProfile,
  saveProfile,
  deleteProfile,
  readGlobalConfig,
  writeGlobalConfig,
  type StoreOptions,
} from '../../config/store.js';
import { profileNameSchema } from '../../config/schema.js';

interface RenameOptions {
  old?: string;
  new?: string;
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

function assertName(value: string | undefined, label: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) exitWith(1, `${label} name is required.`);
  if (!profileNameSchema.safeParse(trimmed).success) {
    exitWith(1, `Invalid ${label.toLowerCase()} profile name "${trimmed}".`);
  }
  return trimmed;
}

export const renameCommand: CommandModule<object, RenameOptions> = {
  command: 'rename <old> <new>',
  describe: 'Rename a profile (file and inner name field)',
  builder: (yargs) =>
    yargs
      .positional('old', {
        type: 'string',
        description: 'Existing profile name',
        demandOption: true,
      })
      .positional('new', {
        type: 'string',
        description: 'New profile name',
        demandOption: true,
      }),

  handler: async (argv) => {
    const opts = buildStoreOptions(argv as Record<string, unknown>);

    const oldName = assertName(argv.old, 'Old');
    const newName = assertName(argv.new, 'New');

    if (oldName === newName) {
      exitWith(1, `Old and new names are identical ("${oldName}").`);
    }

    const existing = loadProfile(oldName, opts);
    if (!existing) {
      exitWith(
        1,
        `Profile "${oldName}" not found.\n  Run \`bounty profile list\` to see available profiles.`,
      );
    }

    if (loadProfile(newName, opts)) {
      exitWith(
        1,
        `Profile "${newName}" already exists.\n  Pick a different name or remove it first with \`bounty profile remove ${newName}\`.`,
      );
    }

    // Mutate the inner name and persist to the new file. PR1's saveProfile
    // uses an atomic temp + rename, so the destination appears in one step.
    const renamed: typeof existing = { ...existing, name: newName };
    try {
      saveProfile(renamed, opts);
    } catch (err) {
      exitWith(1, err instanceof Error ? err.message : String(err));
    }

    // Now that the new file is durable, delete the old one. PR1's deleteProfile
    // is idempotent for missing files, so this is safe even if the disk hiccupped.
    try {
      deleteProfile(oldName, opts);
    } catch (err) {
      exitWith(1, `Profile written to "${newName}" but failed to remove old file "${oldName}": ${err instanceof Error ? err.message : err}`);
    }

    // Sync active_profile if we just renamed the active profile.
    const cfg = readGlobalConfig(opts);
    if (cfg && cfg.active_profile === oldName) {
      try {
        writeGlobalConfig(
          { version: 1, active_profile: newName, schema_version: cfg.schema_version },
          opts,
        );
      } catch (err) {
        exitWith(1, `Renamed files but failed to update config.active_profile: ${err instanceof Error ? err.message : err}`);
      }
    }

    console.log(chalk.green(`\n✓ Profile "${oldName}" renamed to "${newName}"`));
  },
};

export default renameCommand;
