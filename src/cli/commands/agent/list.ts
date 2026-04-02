/**
 * agent list command
 * List all registered agents
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';

export const listCommand: CommandModule = {
  command: 'list',
  describe: 'List all registered agents',
  
  builder: (yargs) =>
    yargs.option('status', {
      alias: 's',
      type: 'string',
      choices: ['active', 'suspended', 'pending'],
      description: 'Filter by agent status',
    }),

  handler: async (argv) => {
    const ctx = createContext();

    try {
      const filter = argv.status ? { status: argv.status as string } : undefined;
      const agents = ctx.agentService.list(filter);

      if (agents.length === 0) {
        console.log(chalk.yellow('\nNo agents found.\n'));
        ctx.db.close();
        return;
      }

      console.log(chalk.bold(`\nAgents (${agents.length}):\n`));
      
      agents.forEach((agent) => {
        console.log(chalk.cyan(`  ${agent.name} (${agent.email})`));
        console.log(chalk.gray(`    ID: ${agent.id}`));
        console.log(chalk.gray(`    Credits: ${agent.credits}`));
        console.log(chalk.gray(`    Status: ${agent.status}`));
        console.log();
      });

      ctx.db.close();
    } catch (error: any) {
      console.error(chalk.red('\n✗ Error:'), error.message);
      ctx.db.close();
      process.exit(1);
    }
  },
};
