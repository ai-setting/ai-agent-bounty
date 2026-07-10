/**
 * bounty complete command
 *
 * v0.7: address-based publisher identity; legacy --publisher-id remains deprecated.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { bountyConfig } from '../../../lib/config/bounty-config.js';
import { addServerUrlOption, resolveServerUrl } from '../../lib/server-url-option.js';
import { bountyHttp } from '../../lib/bounty-http.js';
import { resolveCurrentAgent } from '../../lib/current-agent.js';
import { resolveAgentIdOption } from '../../lib/address-parser.js';
import { handleBountyError } from './publish.js';
import { isValidTaskId } from './grab.js';

interface CompleteOptions {
  'task-id': string;
  'publisher-address'?: string;
  /** @deprecated Use --publisher-address. */
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
        .option('publisher-address', {
          alias: 'p',
          type: 'string',
          description: 'Publisher agent address (<uuid>@<host>). Pure <uuid> is also accepted. Defaults to BOUNTY_IM_ADDRESS env.',
        })
        .option('publisher-id', {
          type: 'string',
          description: '[deprecated] Publisher agent ID. Use --publisher-address instead.',
        })
    ),

  handler: async (argv) => {
    const baseUrl = resolveServerUrl(argv['server-url'], bountyConfig.apiUrl);

    const publisher = resolveAgentIdOption({
      address: argv['publisher-address'],
      deprecatedId: argv['publisher-id'],
      fallback: resolveCurrentAgent(),
      addressFlag: '--publisher-address',
      deprecatedFlag: '--publisher-id',
      missingMessage: '✗ Cannot infer publisher address. Provide --publisher-address or set BOUNTY_IM_ADDRESS.',
    });
    if (!publisher.ok) {
      console.error(chalk.red(`\n${publisher.error}\n`));
      process.exit(2);
    }
    const publisherId = publisher.value;

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
        path: `/api/tasks/${encodeURIComponent(argv['task-id'])}/complete`,
        method: 'PUT',
        body: { agentId: publisherId },
        extraHeaders: { 'X-Agent-Id': publisherId },
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
