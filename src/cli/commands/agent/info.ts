/**
 * agent info command
 * Get detailed information about an agent
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';

export const infoCommand: CommandModule = {
  command: 'info',
  describe: 'Get detailed information about an agent',
  
  builder: (yargs) =>
    yargs
      .option('id', {
        alias: 'i',
        type: 'string',
        description: 'Agent ID',
      })
      .option('email', {
        alias: 'e',
        type: 'string',
        description: 'Agent email',
      }),

  handler: async (argv) => {
    const ctx = createContext();

    try {
      const agent = argv.id
        ? ctx.agentService.getById(argv.id as string)
        : ctx.agentService.getByEmail(argv.email as string);

      if (!agent) {
        console.error(chalk.red('\n✗ Error: Agent not found\n'));
        ctx.db.close();
        process.exit(1);
      }

      const mailAddress = ctx.mailService.getAddressByAgent(agent.id);

      console.log(chalk.bold('\nAgent Info:\n'));
      console.log(chalk.cyan('  ID:'), agent.id);
      console.log(chalk.cyan('  Name:'), agent.name);
      console.log(chalk.cyan('  Email:'), agent.email);
      if (agent.description) {
        console.log(chalk.cyan('  Description:'), agent.description);
      }
      console.log(chalk.cyan('  Credits:'), agent.credits);
      console.log(chalk.cyan('  Status:'), agent.status);
      console.log(
        chalk.cyan('  Created:'),
        new Date(agent.createdAt).toLocaleString()
      );
      if (mailAddress) {
        console.log(chalk.cyan('  Mail:'), mailAddress.address);
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
