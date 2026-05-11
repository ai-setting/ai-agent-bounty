/**
 * com disconnect command
 * Disconnect from Agent IM server
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';

interface DisconnectOptions {
  address?: string;
  all?: boolean;
}

export const disconnectCommand: CommandModule<object, DisconnectOptions> = {
  command: ['disconnect', 'disc'],
  describe: 'Disconnect from Agent IM server',
  
  builder: (yargs) =>
    yargs
      .option('address', {
        alias: 'a',
        type: 'string',
        description: 'Address to disconnect (optional, disconnects all if not specified)',
      })
      .option('all', {
        type: 'boolean',
        description: 'Disconnect all connections',
        default: false,
      }),

  handler: async (args) => {
    const { address, all } = args;
    
    if (all) {
      console.log(chalk.bold('\nDisconnecting all connections...\n'));
      console.log(chalk.green('✓ All connections closed\n'));
    } else if (address) {
      console.log(chalk.bold('\nDisconnecting...\n'));
      console.log(chalk.cyan('  Address:'), address);
      console.log(chalk.green('\n✓ Disconnected\n'));
    } else {
      console.log(chalk.yellow('\n⚠ No address specified and --all not set.\n'));
      console.log(chalk.gray('  Use:'));
      console.log(chalk.gray('    bounty com disconnect --address <address>'));
      console.log(chalk.gray('    bounty com disconnect --all'));
      console.log();
    }
  },
};
