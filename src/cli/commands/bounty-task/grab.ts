/**
 * bounty grab command
 * Grab a bounty task
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';

export const grabCommand: CommandModule = {
  command: 'grab',
  describe: 'Grab a bounty task',
  
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
        description: 'Agent ID (grabber)',
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

      const result = ctx.bountyService.grab(
        argv['task-id'] as string,
        agent.id,
        agent.email
      );

      if (!result.success) {
        console.error(chalk.red('\n✗ Error:'), result.reason);
        ctx.db.close();
        process.exit(1);
      }

      console.log(chalk.green('\n✓ Task grabbed successfully\n'));
      console.log(chalk.cyan('  Task ID:'), argv['task-id']);
      console.log(chalk.cyan('  Grabbed by:'), agent.name);
      console.log();

      ctx.db.close();
    } catch (error: any) {
      console.error(chalk.red('\n✗ Error:'), error.message);
      ctx.db.close();
      process.exit(1);
    }
  },
};
