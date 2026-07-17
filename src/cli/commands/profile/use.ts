/**
 * bounty profile use <name>
 *
 * PR2: Atomically switch the active profile. Reads existing global config to
 * preserve `version` and `schema_version`; if no config exists, initializes it
 * with the PR1 defaults (`{ version: 1, schema_version: '0.11.0' }`). Writes are
 * confined to `__storeOptions.configFile` so the command never touches the
 * user's HOME unless they explicitly pass `--config`.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import {
  loadProfile,
  readGlobalConfig,
  writeGlobalConfig,
  type StoreOptions,
} from '../../config/store.js';
import { profileNameSchema } from '../../config/schema.js';

interface UseOptions {
  name?: string;
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

export const useCommand: CommandModule<object, UseOptions> = {
  command: 'use <name>',
  describe: 'Switch the active profile',
  builder: (yargs) =>
    yargs.positional('name', {
      type: 'string',
      description: 'Profile name to activate',
      demandOption: true,
    }),

  handler: async (argv) => {
    const opts = buildStoreOptions(argv as Record<string, unknown>);

    const rawName = argv.name;
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!name || !profileNameSchema.safeParse(name).success) {
      exitWith(1, `Invalid profile name "${name}".`);
    }

    const profile = loadProfile(name, opts);
    if (!profile) {
      exitWith(
        1,
        `Profile "${name}" not found.\n  Run \`bounty profile add ${name} --api-base <url> --token <jwt>\` to create it.`,
      );
    }

    // Preserve existing schema_version; fall back to PR1 default only on first run.
    // `version` is always pinned to 1 (current schema generation).
    const existing = readGlobalConfig(opts);
    const schema_version = existing?.schema_version ?? '0.11.0';
    void existing?.version; // explicit no-op: version is the schema generation literal.

    writeGlobalConfig(
      { version: 1, active_profile: name, schema_version },
      opts,
    );

    console.log(chalk.green(`\n✓ Active profile set to ${name}\n`));
  },
};

export default useCommand;
