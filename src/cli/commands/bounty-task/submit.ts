/**
 * bounty submit command — v0.14 strict email-only contract.
 *
 * v0.10 BREAKING: bare UUIDs REMOVED.
 * v0.13: --email introduced as PRIMARY; legacy address flag retained.
 * v0.14 BREAKING:
 *   - legacy address flag / -a option REMOVED from surface.
 *   - legacy env fallback REMOVED.
 *   - --email / -e is the ONLY actor identity input.
 *   - <uuid>@<host>, bare UUIDs, malformed emails REJECTED with exit 1.
 *   - HTTP body uses {agentEmail} only (no agentAddress key).
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

interface SubmitOptions {
  'task-id': string;
  email?: string;
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
        .option('email', {
          alias: 'e',
          type: 'string',
          description:
            'Agent email (v0.14 ONLY input). <uuid>@<host> and bare UUIDs REJECTED.',
        })
        .option('result', {
          alias: 'r',
          type: 'string',
          demandOption: true,
          description: 'Task result',
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

    if (!argv.result || !argv.result.trim()) {
      console.error(chalk.red('\n✗ --result cannot be empty.\n'));
      process.exit(2);
    }

    // v0.14 strict: --email is the ONLY actor identity input.
    const parsed = requireEmailFlag('email', argv as Record<string, unknown>);
    if (!parsed.ok) {
      exitWithEmailFlagError(parsed);
    }
    const agentEmail = parsed.value;

    try {
      const task = await bountyHttp<BountyTask>({
        baseUrl,
        path: `/api/tasks/${encodeURIComponent(argv['task-id'])}/submit`,
        method: 'PUT',
        body: { result: argv.result, agentEmail },
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
