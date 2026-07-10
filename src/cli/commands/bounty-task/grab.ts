/**
 * bounty grab command
 *
 * Phase feat/bounty-task-optimize: 重构为 HTTP API 调用
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { bountyConfig } from '../../../lib/config/bounty-config.js';
import { addServerUrlOption, resolveServerUrl } from '../../lib/server-url-option.js';
import { bountyHttp, BountyHttpError } from '../../lib/bounty-http.js';
import { resolveCurrentAgent } from '../../lib/current-agent.js';
import { handleBountyError } from './publish.js';

interface GrabOptions {
  'task-id': string;
  'agent-id'?: string;
  'server-url'?: string;
}

interface BountyTask {
  id: string;
  title?: string;
  status: string;
  assigneeId?: string;
}

export const grabCommand: CommandModule<object, GrabOptions> = {
  command: 'grab',
  describe: 'Grab a bounty task (via HTTP API)',

  builder: (yargs) =>
    addServerUrlOption(
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
          description:
            'Agent ID (grabber). ' +
            'Defaults to BOUNTY_IM_ADDRESS env (e.g., "agent-uuid@host" → "agent-uuid").',
        })
    ),

  handler: async (argv) => {
    const baseUrl = resolveServerUrl(argv['server-url'], bountyConfig.apiUrl);

    let agentId = argv['agent-id'] ?? resolveCurrentAgent();
    if (!agentId) {
      console.error(
        chalk.red('\n✗ Cannot infer agent ID. Provide --agent-id or set BOUNTY_IM_ADDRESS.\n')
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
        path: `/api/tasks/${encodeURIComponent(argv['task-id'])}/grab`,
        method: 'PUT',
        body: { agentId },
      });

      console.log(chalk.green('\n✓ Task grabbed successfully\n'));
      console.log(chalk.cyan('  Task ID:'), task.id);
      console.log(chalk.cyan('  Status:'), task.status);
      if (task.assigneeId) {
        console.log(chalk.cyan('  Grabbed by:'), task.assigneeId);
      }
      console.log();
    } catch (error: any) {
      handleBountyError(error, 'grab task', baseUrl);
    }
  },
};