/**
 * bounty submit command
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
import { isValidTaskId } from './grab.js';

interface SubmitOptions {
  'task-id': string;
  'agent-address'?: string;
  result: string;
  'server-url'?: string;
}

interface BountyTask {
  id: string;
  status: string;
  title?: string;
}

export const submitCommand: CommandModule<object, SubmitOptions> = {
  command: 'submit',
  describe: 'Submit task result (via HTTP API)',

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
        .option('result', {
          alias: 'r',
          type: 'string',
          demandOption: true,
          description: 'Task result',
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

    if (!argv.result || !argv.result.trim()) {
      console.error(chalk.red('\n✗ --result cannot be empty.\n'));
      process.exit(2);
    }

    try {
      const task = await bountyHttp<BountyTask>({
        baseUrl,
        path: `/api/tasks/${encodeURIComponent(argv['task-id'])}/submit`,
        method: 'PUT',
        body: { agentAddress, result: argv.result },
        extraHeaders: { 'X-Agent-Id': agentUuid },
      });

      console.log(chalk.green('\n✓ Result submitted successfully\n'));
      console.log(chalk.cyan('  Task ID:'), task.id);
      console.log(chalk.cyan('  Status:'), task.status);
      console.log();
    } catch (error: any) {
      handleBountyError(error, 'submit task result', baseUrl);
    }
  },
};
