/**
 * bounty complete command
 *
 * Phase feat/bounty-task-optimize: 重构为 HTTP API 调用
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { bountyConfig } from '../../../lib/config/bounty-config.js';
import { addServerUrlOption, resolveServerUrl } from '../../lib/server-url-option.js';
import { bountyHttp } from '../../lib/bounty-http.js';
import { resolveCurrentAgent } from '../../lib/current-agent.js';
import { handleBountyError } from './publish.js';

interface CompleteOptions {
  'task-id': string;
  'publisher-id'?: string;
  'server-url'?: string;
}

interface BountyTask {
  id: string;
  status: string;
  reward?: number;
  title?: string;
  assigneeId?: string;
}

export const completeCommand: CommandModule<object, CompleteOptions> = {
  command: 'complete',
  describe: 'Complete/approve a task (via HTTP API)',

  builder: (yargs) =>
    addServerUrlOption(
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
          description:
            'Publisher agent ID. ' +
            'Defaults to BOUNTY_IM_ADDRESS env (e.g., "agent-uuid@host" → "agent-uuid").',
        })
    ),

  handler: async (argv) => {
    const baseUrl = resolveServerUrl(argv['server-url'], bountyConfig.apiUrl);

    let publisherId = argv['publisher-id'] ?? resolveCurrentAgent();
    if (!publisherId) {
      console.error(
        chalk.red(
          '\n✗ Cannot infer publisher ID. Provide --publisher-id or set BOUNTY_IM_ADDRESS.\n'
        )
      );
      process.exit(2);
    }

    if (!argv['task-id']) {
      console.error(chalk.red('\n✗ --task-id is required.\n'));
      process.exit(2);
    }

    try {
      const task = await bountyHttp<BountyTask>({
        baseUrl,
        path: `/api/tasks/${encodeURIComponent(argv['task-id'])}/complete`,
        method: 'PUT',
        body: { agentId: publisherId },
      });

      console.log(chalk.green('\n✓ Task completed successfully\n'));
      console.log(chalk.cyan('  Task ID:'), task.id);
      console.log(chalk.cyan('  Status:'), task.status);
      if (task.reward !== undefined) {
        console.log(chalk.cyan('  Reward:'), task.reward, 'credits released');
      }
      if (task.assigneeId) {
        console.log(chalk.cyan('  Assigned to:'), task.assigneeId);
      }
      console.log();
    } catch (error: any) {
      handleBountyError(error, 'complete task', baseUrl);
    }
  },
};