/**
 * auth logout command
 * Clear stored authentication token
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { clearToken } from '../../storage.js';

export const logoutCommand: CommandModule = {
  command: 'logout',
  describe: 'Clear stored authentication token',

  handler: async () => {
    try {
      await clearToken();
      console.log(chalk.green('\n✓ Logged out successfully'));
      console.log('  Token cleared from storage');
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : 'Logout failed'}\n`));
      process.exit(1);
    }
  },
};
