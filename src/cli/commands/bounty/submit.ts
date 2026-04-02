/**
 * bounty submit command
 * Submit task result
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';

export const submitCommand: CommandModule = {
  command: 'submit',
  describe: 'Submit task result',
  
  builder: (yargs) =>
    yargs
      .option('task-id', {
        alias: 't',
        type: 'string',
        demandOption: true,
        description: 'Task ID',
      })
      .option('agent-id', {
        alias: 'a',
        type: 'string',
        demandOption: true,
        description: 'Agent ID (assignee)',
      })
      .option('result', {
        alias: 'r',
        type: 'string',
        demandOption: true,
        description: 'Task result',
      }),

  handler: async (argv) => {
    const ctx = createContext();

    try {
      const agent = ctx.agentService.getById(argv['agent-id'] as string);
      if (!agent) {
        console.error(chalk.red('\n✗ Error: Agent not found\n'));
        ctx.db.close();
        process.exit(1);
      }

      const result = ctx.bountyService.submit(
        argv['task-id'] as string,
        agent.id,
        argv.result as string
      );

      if (!result.success) {
        console.error(chalk.red('\n✗ Error:'), result.reason);
        ctx.db.close();
        process.exit(1);
      }

      console.log(chalk.green('\n✓ Result submitted successfully\n'));
      console.log(chalk.cyan('  Task ID:'), argv['task-id']);
      console.log(chalk.cyan('  Submitted by:'), agent.name);
      console.log();

      ctx.db.close();
    } catch (error: any) {
      console.error(chalk.red('\n✗ Error:'), error.message);
      ctx.db.close();
      process.exit(1);
    }
  },
};
