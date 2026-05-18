/**
 * bounty board command
 * View bounty task board (open tasks)
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';

export const boardCommand: CommandModule = {
  command: 'board',
  describe: 'View bounty task board (open tasks)',
  
  builder: (yargs) =>
    yargs
      .option('type', {
        alias: 'y',
        type: 'string',
        description: 'Filter by task type',
      })
      .option('min-reward', {
        type: 'number',
        description: 'Minimum reward',
      })
      .option('max-reward', {
        type: 'number',
        description: 'Maximum reward',
      }),

  handler: async (argv) => {
    const ctx = createContext();

    try {
      const filter: any = {};
      if (argv.type) filter.type = argv.type;
      if (argv['min-reward']) filter.minReward = argv['min-reward'];
      if (argv['max-reward']) filter.maxReward = argv['max-reward'];

      const tasks = ctx.bountyService.getBoard(filter);

      if (tasks.length === 0) {
        console.log(chalk.yellow('\nNo open tasks found.\n'));
        ctx.db.close();
        return;
      }

      console.log(chalk.bold(`\nBounty Board (${tasks.length} open tasks):\n`));
      
      tasks.forEach((task, i) => {
        console.log(chalk.cyan(`[${i + 1}] ${task.title}`));
        console.log(chalk.gray(`    ID: ${task.id}`));
        console.log(chalk.gray(`    Type: ${task.type} | Reward: ${task.reward} credits`));
        console.log(chalk.gray(`    Publisher: ${task.publisherEmail}`));
        if (task.tags && task.tags.length > 0) {
          console.log(chalk.gray(`    Tags: ${task.tags.join(', ')}`));
        }
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
