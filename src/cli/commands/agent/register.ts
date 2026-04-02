/**
 * agent register command
 * Register a new agent in the bounty system
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';

export const registerCommand: CommandModule = {
  command: 'register',
  describe: 'Register a new agent in the bounty system',
  
  builder: (yargs) =>
    yargs
      .option('name', {
        alias: 'n',
        type: 'string',
        demandOption: true,
        description: 'Agent name',
      })
      .option('email', {
        alias: 'e',
        type: 'string',
        demandOption: true,
        description: 'Agent email',
      })
      .option('description', {
        alias: 'd',
        type: 'string',
        description: 'Agent description (optional)',
      })
      .option('public-key', {
        alias: 'k',
        type: 'string',
        description: 'Public key for verification (optional)',
      }),

  handler: async (argv) => {
    const ctx = createContext();

    try {
      // 注册新 Agent
      const agent = ctx.agentService.register({
        name: argv.name as string,
        email: argv.email as string,
        description: argv.description as string | undefined,
        publicKey: argv['public-key'] as string | undefined,
      });

      // 自动注册邮件地址
      const mailAddress = ctx.mailService.registerAddress(agent.id, agent.name);

      console.log(chalk.green('\n✓ Agent registered successfully\n'));
      console.log(chalk.cyan('  ID:'), agent.id);
      console.log(chalk.cyan('  Name:'), agent.name);
      console.log(chalk.cyan('  Email:'), agent.email);
      if (agent.description) {
        console.log(chalk.cyan('  Description:'), agent.description);
      }
      console.log(chalk.cyan('  Credits:'), agent.credits);
      console.log(chalk.cyan('  Status:'), agent.status);
      console.log(chalk.cyan('  Mail:'), mailAddress.address);
      console.log();

      ctx.db.close();
    } catch (error: any) {
      console.error(chalk.red('\n✗ Error:'), error.message);
      ctx.db.close();
      process.exit(1);
    }
  },
};
