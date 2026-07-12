/**
 * bounty grab command
 *
 * v0.10: STRICT address-based agent identity (`<uuid>@<host>` required).
 * Bare UUID and `--agent-id` flag REMOVED (BREAKING).
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { bountyConfig } from '../../../lib/config/bounty-config.js';
import { addServerUrlOption, resolveServerUrl } from '../../lib/server-url-option.js';
import { bountyHttp } from '../../lib/bounty-http.js';
import { resolveCurrentAgent, resolveCurrentAgentAddress } from '../../lib/current-agent.js';
import { resolveAddressOption } from '../../lib/address-parser.js';
import { handleBountyError } from './publish.js';

interface GrabOptions {
  'task-id': string;
  'agent-address'?: string;
  'server-url'?: string;
}

interface BountyTask {
  id: string;
  title?: string;
  status: string;
  assigneeId?: string;
}

/**
 * Validate that a task ID is in UUID v4 format.
 * Bounty server generates UUIDs for task IDs; rejecting malformed IDs
 * client-side avoids unnecessary HTTP roundtrips and gives clearer errors.
 */
export function isValidTaskId(taskId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId);
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
        .option('agent-address', {
          alias: 'a',
          type: 'string',
          description:
            'Agent address in <uuid>@<host> format (REQUIRED). ' +
            'Bare UUID is REJECTED in v0.10. Defaults to BOUNTY_IM_ADDRESS env.',
        })
    ),

  handler: async (argv) => {
    const baseUrl = resolveServerUrl(argv['server-url'], bountyConfig.apiUrl);

    const agent = resolveAddressOption({
      address: argv['agent-address'],
      fallback: resolveCurrentAgentAddress(),
      addressFlag: '--agent-address',
      missingMessage:
        '✗ Cannot infer agent address. Provide --agent-address <uuid>@<host> or set BOUNTY_IM_ADDRESS=<uuid>@<host>.',
    });
    if (!agent.ok) {
      console.error(chalk.red(`\n${agent.error}\n`));
      process.exit(2);
    }
    const agentUuid = agent.value.uuid;
    const agentAddress = agent.value.raw;

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
        path: `/api/tasks/${encodeURIComponent(argv['task-id'])}/grab`,
        method: 'PUT',
        body: { agentAddress },
        extraHeaders: { 'X-Agent-Id': agentUuid },
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
