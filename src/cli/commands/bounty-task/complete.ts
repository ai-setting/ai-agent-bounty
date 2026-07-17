/**
 * bounty complete command — v0.14 strict email-only contract.
 *
 * v0.10 BREAKING: bare UUIDs REMOVED.
 * v0.14 BREAKING:
 *   - --publisher-address / -p REMOVED (renamed to --publisher-email / -e).
 *   - legacy env fallback REMOVED.
 *   - --publisher-email is the ONLY publisher identity input.
 *   - HTTP body uses {publisherEmail} only.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
import { ProfileContext } from '../../config/context.js';
import { resolveProfileApiBase } from '../../lib/profile-api-base.js';
import { addServerUrlOption, resolveServerUrl } from '../../lib/server-url-option.js';
import { bountyHttp } from '../../lib/bounty-http.js';
import { requireEmailFlag, exitWithEmailFlagError } from '../../lib/email-flag.js';
import { handleBountyError } from './publish.js';
import { isValidTaskId } from './grab.js';

interface CompleteOptions {
  'task-id': string;
  'publisher-email'?: string;
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
        .option('publisher-email', {
          alias: 'e',
          type: 'string',
          description:
            'Publisher agent email (v0.14 ONLY input). <uuid>@<host> and bare UUIDs REJECTED.',
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

    // v0.14 strict: --publisher-email is the ONLY publisher identity input.
    const parsed = requireEmailFlag(
      'publisher-email',
      argv as Record<string, unknown>,
    );
    if (!parsed.ok) {
      exitWithEmailFlagError(parsed);
    }
    const publisherEmail = parsed.value;

    try {
      const task = await bountyHttp<BountyTask>({
        baseUrl,
        path: `/api/tasks/${encodeURIComponent(argv['task-id'])}/complete`,
        method: 'PUT',
        body: { publisherEmail },
      });

      console.log(chalk.green('\n✓ Task completed successfully\n'));
      console.log(chalk.cyan('  Task ID:'), task.id);
      console.log(chalk.cyan('  Status:'), task.status);
      if (task.assigneeId) {
        console.log(chalk.cyan('  Completed by:'), task.assigneeId);
      }
      console.log();
    } catch (error: any) {
      handleBountyError(error, 'complete task', baseUrl);
    }
  },
};
