/**
 * com disconnect command
 *
 * STUB: this command does not maintain an open connection, so
 * "disconnecting" is a no-op beyond printing a placeholder
 * notice. It exists for symmetry with `connect` and so that
 * scripts which chain the two commands do not silently lose
 * messages.
 */

import type { CommandModule } from 'yargs';
import { printStubNotice } from './stub.js';

interface DisconnectOptions {
  address?: string;
  all?: boolean;
}

export const disconnectCommand: CommandModule<object, DisconnectOptions> = {
  command: ['disconnect', 'disc'],
  describe: 'Disconnect from Agent IM server (placeholder, no persistent connection)',

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

    if (!all && !address) {
      printStubNotice('disconnect', {});
      console.log('  Use one of:');
      console.log('    bounty com disconnect --address <address>');
      console.log('    bounty com disconnect --all');
      console.log();
      return;
    }

    printStubNotice('disconnect', { address, all });
  },
};
