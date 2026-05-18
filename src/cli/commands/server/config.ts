/**
 * server config command
 * Show server configuration
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { join } from 'path';

export const configCommand: CommandModule = {
  command: 'config',
  describe: 'Show server configuration',

  handler: async () => {
    console.log(chalk.cyan('\n⚙️  Server Configuration\n'));

    const configItems = [
      { name: 'BOUNTY_PORT', default: '4000', desc: 'HTTP server port' },
      { name: 'BOUNTY_DOMAIN', default: 'bounty.local', desc: 'Domain for agent addresses' },
      { name: 'BOUNTY_DB_PATH', default: './data/bounty.db', desc: 'Database file path' },
      { name: 'BOUNTY_IM_PORT', default: '4002', desc: 'IM WebSocket server port' },
      { name: 'BOUNTY_IM_ADDRESS', default: '', desc: 'Your IM address (auto-set after register)' },
      { name: 'API_BASE', default: 'http://localhost:4000', desc: 'API base URL' },
      { name: 'SMTP_HOST', default: '', desc: 'SMTP server host' },
      { name: 'SMTP_PORT', default: '587', desc: 'SMTP server port' },
      { name: 'SMTP_USER', default: '', desc: 'SMTP username' },
      { name: 'JWT_SECRET', default: '', desc: 'JWT secret (auto-generated if not set)' },
    ];

    // Print header
    console.log(chalk.bold('  Name                    Current                          Default     Description'));
    console.log(chalk.bold('  ─────────────────────────────────────────────────────────────────────────────────────'));

    for (const item of configItems) {
      const current = process.env[item.name] || chalk.gray(`(not set)`);
      const defaultVal = chalk.gray(item.default);
      
      const namePad = item.name.padEnd(24);
      const currentStr = typeof current === 'string' ? current : '';
      const currentPad = currentStr ? currentStr.padEnd(30) : '                              ';
      const defaultPad = item.default.padEnd(11);
      void defaultVal; // suppress warning
      
      if (currentStr && currentStr !== `(not set)`) {
        console.log(`  ${chalk.yellow(namePad)} ${chalk.green(currentPad)} ${defaultPad} ${item.desc}`);
      } else {
        console.log(`  ${chalk.yellow(namePad)} ${currentPad} ${defaultPad} ${item.desc}`);
      }
    }

    console.log(chalk.bold('\n  ─────────────────────────────────────────────────────────────────────────────────────'));

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
