/**
 * server config command
 * Show server configuration
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { bountyConfig } from '../../../lib/config/bounty-config.js';

export const configCommand: CommandModule = {
  command: 'config',
  describe: 'Show server configuration',

  handler: async () => {
    console.log(chalk.cyan('\n⚙️  Server Configuration\n'));

    // Print header
    console.log(chalk.bold('  Name                      Current                               Default     Description'));
    console.log(chalk.bold('  ────────────────────────────────────────────────────────────────────────────────────────────'));

    for (const item of bountyConfig.toConfigItems()) {
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

    // Show URLs
    console.log(`\n  ${chalk.cyan('Server URLs (from bountyConfig):')}`);
    console.log(`  HTTP:      ${bountyConfig.url}`);
    console.log(`  WebSocket: ${bountyConfig.wsUrl}`);
    console.log(`  Health:    ${bountyConfig.url}/health`);
    console.log(`  IM Server: ${bountyConfig.getImServerUrl()}`);

    // Try to read package.json for version
    try {
      const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
      if (pkg.version) {
        console.log(`\n  ${chalk.cyan('Version:')} ${pkg.version}`);
      }
    } catch {
      // Ignore
    }

    console.log();
  },
};
