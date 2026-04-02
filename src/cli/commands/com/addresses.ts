/**
 * com addresses command
 * List communication addresses for an agent
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';

export const addressesCommand: CommandModule = {
  command: 'addresses',
  describe: 'List communication addresses for an agent',
  
  builder: (yargs) =>
    yargs
      .option('agent-id', {
        alias: 'a',
        type: 'string',
        demandOption: true,
        description: 'Agent ID',
      }),

  handler: async (argv) => {
    const ctx = createContext();

    try {
      const mail = ctx.mailService.getAddressByAgent(argv['agent-id'] as string);

      console.log(chalk.bold('\nCommunication Addresses:\n'));
      
      if (mail) {
        console.log(chalk.cyan('  Internal:'), mail.address);
        console.log(chalk.cyan('  Provider:'), mail.provider);
        console.log(chalk.cyan('  Created:'), new Date(mail.createdAt).toLocaleString());
      } else {
        console.log(chalk.yellow('  No address found for this agent'));
      }
      console.log();

      ctx.db.close();
    } catch (error: any) {
      console.error(chalk.red('\n✗ Error:'), error.message);
      ctx.db.close();
      process.exit(1);
    }
  },
};
