/**
 * bounty board command
 *
 * Phase feat/bounty-task-optimize: 重构为 HTTP API 调用
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { bountyConfig } from '../../../lib/config/bounty-config.js';
import { addServerUrlOption, resolveServerUrl } from '../../lib/server-url-option.js';
import { bountyHttp } from '../../lib/bounty-http.js';
import { handleBountyError } from './publish.js';

interface BoardOptions {
  type?: string;
  'min-reward'?: number;
  'max-reward'?: number;
  'server-url'?: string;
}

interface BountyTask {
  id: string;
  title: string;
  description?: string;
  type: string;
  reward: number;
  status: string;
  publisherEmail?: string;
  publisherId?: string;
  tags?: string[];
}

export const boardCommand: CommandModule<object, BoardOptions> = {
  command: 'board',
  describe: 'View bounty task board (open tasks) via HTTP API',

  builder: (yargs) =>
    addServerUrlOption(
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
        })
    ),

  handler: async (argv) => {
    const baseUrl = resolveServerUrl(argv['server-url'], bountyConfig.apiUrl);

    // Build query string from filters (with input validation)
    const params = new URLSearchParams();
    params.set('status', 'open'); // board only shows open tasks
    if (argv.type && argv.type.trim()) params.set('type', argv.type.trim());
    if (argv['min-reward'] !== undefined) {
      if (argv['min-reward'] < 0) {
        console.error(chalk.red('\n✗ --min-reward must be >= 0.\n'));
        process.exit(2);
      }
      params.set('minReward', String(argv['min-reward']));
    }
    if (argv['max-reward'] !== undefined) {
      if (argv['max-reward'] < 0) {
        console.error(chalk.red('\n✗ --max-reward must be >= 0.\n'));
        process.exit(2);
      }
      params.set('maxReward', String(argv['max-reward']));
    }
    const query = params.toString();
    const path = `/api/tasks${query ? `?${query}` : ''}`;

    try {
      const tasks = await bountyHttp<BountyTask[]>({
        baseUrl,
        path,
        method: 'GET',
      });

      if (tasks.length === 0) {
        console.log(chalk.yellow('\nNo open tasks found.\n'));
        return;
      }

      console.log(chalk.bold(`\nBounty Board (${tasks.length} open tasks):\n`));

      tasks.forEach((task, i) => {
        console.log(chalk.cyan(`[${i + 1}] ${task.title}`));
        console.log(chalk.gray(`    ID: ${task.id}`));
        console.log(chalk.gray(`    Type: ${task.type} | Reward: ${task.reward} credits`));
        console.log(chalk.gray(`    Publisher: ${task.publisherEmail ?? task.publisherId ?? 'unknown'}`));
        if (task.tags && task.tags.length > 0) {
          console.log(chalk.gray(`    Tags: ${task.tags.join(', ')}`));
        }
        console.log();
      });
    } catch (error: any) {
      handleBountyError(error, 'list bounty board', baseUrl);
    }
  },
};