/**
 * bounty cancel command
 * Cancel a bounty task
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';

export const cancelCommand: CommandModule = {
  command: 'cancel',
  describe: 'Cancel a bounty task',
  
  builder: (yargs) =>
    yargs
      .option('task-id', {
        alias: 't',
        type: 'string',
        demandOption: true,
        description: 'Task ID',
      })
      .option('publisher-id', {
        alias: 'p',
        type: 'string',
        demandOption: true,
        description: 'Publisher agent ID',
      }),

  handler: async (argv) => {
    const ctx = createContext();

    try {
      const publisher = ctx.agentService.getById(argv['publisher-id'] as string);
      if (!publisher) {
        console.error(chalk.red('\n✗ Error: Publisher agent not found\n'));
        ctx.db.close();
        process.exit(1);
      }

      const result = ctx.bountyService.cancel(
        argv['task-id'] as string,
        publisher.id
      );

      if (!result.success) {
        console.error(chalk.red('\n✗ Error:'), result.reason);
        ctx.db.close();
        process.exit(1);
      }

      console.log(chalk.green('\n✓ Task cancelled successfully\n'));
      console.log(chalk.cyan('  Task ID:'), argv['task-id']);
      console.log(chalk.cyan('  Credits returned to publisher'));
      console.log();

      ctx.db.close();
    } catch (error: any) {
      console.error(chalk.red('\n✗ Error:'), error.message);
      ctx.db.close();
      process.exit(1);
    }
  },
};
