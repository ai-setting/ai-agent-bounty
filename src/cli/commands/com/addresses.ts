/**
 * com addresses command
 * List registered addresses for an agent
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';

interface AddressesOptions {
  agentId?: string;
}

export const addressesCommand: CommandModule<object, AddressesOptions> = {
  command: ['addresses', 'addr'],
  describe: 'List registered IM addresses',
  
  builder: (yargs) =>
    yargs
      .option('agent-id', {
        alias: 'a',
        type: 'string',
        description: 'Agent ID (optional, uses default if not specified)',
      }),

  handler: async (args) => {
    const { agentId } = args;
    
    // In the new Agent IM system, addresses are just strings (agent-id@host)
    // No registration is needed - agents can use any address format
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
  },
};
