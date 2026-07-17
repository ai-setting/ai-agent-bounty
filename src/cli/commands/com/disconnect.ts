/**
 * com disconnect command
 *
 * STUB: this command does not maintain an open connection, so
 * "disconnecting" is a no-op beyond printing a placeholder
 * notice. It exists for symmetry with `connect` and so that
 * scripts which chain the two commands do not silently lose
 * messages.
 *
 * Phase feat/v0.13-email-instead-of-uuid:
 * - 新增 --email 选项（v0.13 primary）；--address 仍可用（legacy）
 */

import type { CommandModule } from 'yargs';
import { printStubNotice } from './stub.js';

interface DisconnectOptions {
  email?: string;
  address?: string;
  all?: boolean;
}

export const disconnectCommand: CommandModule<object, DisconnectOptions> = {
  command: ['disconnect', 'disc'],
  describe: 'Disconnect from Agent IM server (placeholder, no persistent connection)',

  builder: (yargs) =>
    yargs
      .option('email', {
        alias: 'e',
        type: 'string',
        description: 'Agent email (v0.13 primary; preferred over --address)',
      })
      .option('address', {
        alias: 'a',
        type: 'string',
        description:
          'Agent address (format: <uuid>@<host>) [LEGACY: prefer --email in v0.13]',
      })
      .option('all', {
        type: 'boolean',
        description: 'Disconnect all connections',
        default: false,
      }),

  handler: async (args) => {
    const { email, address, all } = args;
    const identifier = (typeof email === 'string' && email.trim())
      ? email.trim()
      : address;

    if (!all && !identifier) {
      printStubNotice('disconnect', {});
      console.log('  Use one of:');
      console.log('    bounty com disconnect --email <email>');
      console.log('    bounty com disconnect --address <address>');
      console.log('    bounty com disconnect --all');
      console.log();
      return;
    }

    printStubNotice('disconnect', { identifier, all });
  },
};
