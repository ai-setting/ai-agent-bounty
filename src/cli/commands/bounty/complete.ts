/**
 * bounty complete command
 * Complete/approve a task
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';

export const completeCommand: CommandModule = {
  command: 'complete',
  describe: 'Complete/approve a task',
  
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

      const result = ctx.bountyService.complete(
        argv['task-id'] as string,
        publisher.id
      );

      if (!result.success) {
        console.error(chalk.red('\n✗ Error:'), result.reason);
        ctx.db.close();
        process.exit(1);
      }

      const task = ctx.bountyService.getById(argv['task-id'] as string);
      const assignee = task?.assigneeId ? ctx.agentService.getById(task.assigneeId) : null;

      console.log(chalk.green('\n✓ Task completed successfully\n'));
      console.log(chalk.cyan('  Task ID:'), argv['task-id']);
      console.log(chalk.cyan('  Reward:'), task?.reward, 'credits released');
      if (assignee) {
        console.log(chalk.cyan('  Assigned to:'), assignee.name);
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
