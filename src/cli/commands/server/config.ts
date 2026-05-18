/**
 * server config command
 * Show server configuration
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CONFIG_ITEMS } from '../../config-env.js';

export const configCommand: CommandModule = {
  command: 'config',
  describe: 'Show server configuration',

  handler: async () => {
    console.log(chalk.cyan('\n⚙️  Server Configuration\n'));

    // Print header
    console.log(chalk.bold('  Name                      Current                               Default     Description'));
    console.log(chalk.bold('  ────────────────────────────────────────────────────────────────────────────────────────────'));

    for (const item of CONFIG_ITEMS) {
      const current = process.env[item.envKey] || chalk.gray(`(not set)`);
      const namePad = item.name.padEnd(24);
      const currentStr = typeof current === 'string' ? current : '';
      const currentPad = currentStr ? currentStr.padEnd(34) : '                                  ';
      const defaultPad = item.default.padEnd(11);

      if (currentStr && currentStr !== `(not set)`) {
        console.log(`  ${chalk.yellow(namePad)} ${chalk.green(currentPad)} ${chalk.gray(defaultPad)} ${item.desc}`);
      } else {
        console.log(`  ${chalk.yellow(namePad)} ${currentPad} ${chalk.gray(defaultPad)} ${item.desc}`);
      }
    }

    console.log(chalk.bold('\n  ────────────────────────────────────────────────────────────────────────────────────────────'));

    // Show database path
    const dbPath = process.env.BOUNTY_DB_PATH || './data/bounty.db';
    console.log(`\n  ${chalk.cyan('Database:')} ${dbPath}`);

    // Try to read package.json for version
    try {
      const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
      if (pkg.version) {
        console.log(`  ${chalk.cyan('Version:')} ${pkg.version}`);
      }
    } catch {
      // Ignore
    }

    console.log();
  },
};
