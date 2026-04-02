/**
 * bounty publish command
 * Publish a new bounty task
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';

export const publishCommand: CommandModule = {
  command: 'publish',
  describe: 'Publish a new bounty task',
  
  builder: (yargs) =>
    yargs
      .option('title', {
        alias: 't',
        type: 'string',
        demandOption: true,
        description: 'Task title',
      })
      .option('description', {
        alias: 'd',
        type: 'string',
        demandOption: true,
        description: 'Task description',
      })
      .option('type', {
        alias: 'y',
        type: 'string',
        demandOption: true,
        description: 'Task type (e.g., coding, writing, research)',
      })
      .option('reward', {
        alias: 'r',
        type: 'number',
        demandOption: true,
        description: 'Reward credits',
      })
      .option('publisher-id', {
        alias: 'p',
        type: 'string',
        demandOption: true,
        description: 'Publisher agent ID',
      })
      .option('tags', {
        alias: 'g',
        type: 'string',
        description: 'Comma-separated tags',
      })
      .option('deadline', {
        alias: 'l',
        type: 'number',
        description: 'Deadline timestamp',
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

      const tags = argv.tags 
        ? (argv.tags as string).split(',').map(t => t.trim()) 
        : undefined;

      const task = ctx.bountyService.publish({
        title: argv.title as string,
        description: argv.description as string,
        type: argv.type as string,
        reward: argv.reward as number,
        publisherId: publisher.id,
        publisherEmail: publisher.email,
        tags,
        deadline: argv.deadline as number | undefined,
      });

      console.log(chalk.green('\n✓ Task published successfully\n'));
      console.log(chalk.cyan('  ID:'), task.id);
      console.log(chalk.cyan('  Title:'), task.title);
      console.log(chalk.cyan('  Type:'), task.type);
      console.log(chalk.cyan('  Reward:'), task.reward, 'credits');
      console.log(chalk.cyan('  Status:'), task.status);
      console.log();

      ctx.db.close();
    } catch (error: any) {
      console.error(chalk.red('\n✗ Error:'), error.message);
      ctx.db.close();
      process.exit(1);
    }
  },
};
