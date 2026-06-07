/**
 * com addresses command
 *
 * STUB: addresses in the Agent IM model are just strings of the
 * form `agent-id@host`. There is no global registry to list, so
 * this command prints the address-format documentation and the
 * agent's default address (when --agent-id is supplied). The
 * placeholder notice makes it clear that nothing has been queried
 * server-side.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { printStubNotice } from './stub.js';

interface AddressesOptions {
  agentId?: string;
}

export const addressesCommand: CommandModule<object, AddressesOptions> = {
  command: ['addresses', 'addr'],
  describe: 'Show address format and the local agent default (placeholder)',

  builder: (yargs) =>
    yargs
      .option('agent-id', {
        alias: 'a',
        type: 'string',
        description: 'Agent ID (optional, uses default if not specified)',
      }),

  handler: async (args) => {
    const { agentId } = args;

    console.log(chalk.bold('\nAgent IM Addresses\n'));
    console.log(chalk.gray('  Format: agent-id@host\n'));
    console.log(chalk.cyan('  Example addresses:'));
    console.log(chalk.gray('    alice@server.com'));
    console.log(chalk.gray('    bob@production.local'));
    console.log(chalk.gray('    worker-001@localhost'));
    console.log();

    if (agentId) {
      console.log(chalk.cyan('  Agent ID:'), agentId);
      console.log(chalk.cyan('  Default Address:'), `${agentId}@localhost`);
      console.log();
    }

    printStubNotice('addresses', { agentId });
  },
};
