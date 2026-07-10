/**
 * bounty cancel command
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
import { isValidTaskId } from './grab.js';

interface CancelOptions {
  'task-id': string;
  'publisher-id'?: string;
  'server-url'?: string;
}

interface BountyTask {
  id: string;
  status: string;
}

export const cancelCommand: CommandModule<object, CancelOptions> = {
  command: 'cancel',
  describe: 'Cancel a bounty task (via HTTP API)',

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

    if (!isValidTaskId(argv['task-id'])) {
      console.error(
        chalk.red(
          `\n✗ Invalid --task-id: "${argv['task-id']}". Expected UUID v4 format ` +
            `(e.g., 8de9b6aa-5781-4a65-be96-45185fb7c8b1).\n`
        )
      );
      process.exit(2);
    }

    try {
      const task = await bountyHttp<BountyTask>({
        baseUrl,
        path: `/api/tasks/${encodeURIComponent(argv['task-id'])}/cancel`,
        method: 'PUT',
        body: { agentId: publisherId },
      });

      console.log(chalk.green('\n✓ Task cancelled successfully\n'));
      console.log(chalk.cyan('  Task ID:'), task.id);
      console.log(chalk.cyan('  Status:'), task.status);
      console.log(chalk.gray('  Credits returned to publisher'));
      console.log();
    } catch (error: any) {
      handleBountyError(error, 'cancel task', baseUrl);
    }
  },
};