/**
 * com disconnect command
 * Stop IMAP IDLE monitoring
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';

// Import from connect.ts to access shared state
import { activeIdleServices } from './connect.js';

export const disconnectCommand: CommandModule = {
  command: 'disconnect',
  describe: 'Stop IMAP IDLE monitoring',
  
  builder: (yargs) =>
    yargs
      .option('agent-id', {
        alias: 'a',
        type: 'string',
        demandOption: true,
        description: 'Agent ID',
      }),

  handler: async (argv) => {
    try {
      const idleService = activeIdleServices.get(argv['agent-id'] as string);
      
      if (!idleService) {
        console.log(chalk.yellow('\n⚠ Not connected for this agent\n'));
        return;
      }

      await idleService.stop();
      activeIdleServices.delete(argv['agent-id'] as string);

      console.log(chalk.green('\n✓ Disconnected successfully\n'));
    } catch (error: any) {
      console.error(chalk.red('\n✗ Error:'), error.message);
      process.exit(1);
    }
  },
};
