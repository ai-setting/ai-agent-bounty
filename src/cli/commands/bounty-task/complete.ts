/**
 * bounty complete command
 *
 * v0.10: STRICT address-based publisher identity (`<uuid>@<host>` required).
 * Bare UUID and `--publisher-id` flag REMOVED (BREAKING).
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
import { ProfileContext } from '../../config/context.js';
import { resolveProfileApiBase } from '../../lib/profile-api-base.js';
import { addServerUrlOption, resolveServerUrl } from '../../lib/server-url-option.js';
import { bountyHttp } from '../../lib/bounty-http.js';
import { resolveCurrentAgentAddress } from '../../lib/current-agent.js';
import { resolveAddressOption } from '../../lib/address-parser.js';
import { handleBountyError } from './publish.js';
import { isValidTaskId } from './grab.js';

interface CompleteOptions {
  'task-id': string;
  'publisher-address'?: string;
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
          description:
            'Publisher agent address in <uuid>@<host> format (REQUIRED). ' +
            'Bare UUID is REJECTED in v0.10. Defaults to BOUNTY_IM_ADDRESS env.',
        })
    ),

  handler: async (argv) => {
    const profile = ProfileContext.getActive();
    const baseUrl = resolveProfileApiBase({
      cliServerUrl: argv['server-url'] as string | undefined,
      fallbackApiBase: API_BASE,
      profile,
      resolveServerUrlFn: resolveServerUrl,
    });

    const publisher = resolveAddressOption({
      address: argv['publisher-address'],
      fallback: resolveCurrentAgentAddress(),
      addressFlag: '--publisher-address',
      missingMessage:
        '✗ Cannot infer publisher address. Provide --publisher-address <uuid>@<host> or set BOUNTY_IM_ADDRESS=<uuid>@<host>.',
    });
    if (!publisher.ok) {
      console.error(chalk.red(`\n${publisher.error}\n`));
      process.exit(2);
    }
    const publisherUuid = publisher.value.uuid;
    const publisherAddress = publisher.value.raw;

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
        // v0.10: send full `<uuid>@<host>` (BREAKING — server rejects bare UUID)
        body: { publisherAddress },
        extraHeaders: { 'X-Agent-Id': publisherUuid },
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
