/**
 * bounty grab command — v0.14 strict email-only contract.
 *
 * v0.10 BREAKING: bare UUIDs REMOVED.
 * v0.13: --email introduced as PRIMARY; legacy address flag retained.
 * v0.14 BREAKING:
 *   - legacy address flag / -a option REMOVED from surface.
 *   - legacy env fallback REMOVED.
 *   - --email / -e is the ONLY actor identity input.
 *   - <uuid>@<host>, bare UUIDs, malformed emails are REJECTED with exit 1
 *     and a clear "use --email <your-registered-email>" hint.
 *   - HTTP body uses {agentEmail} only (no agentAddress key).
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
import { ProfileContext } from '../../config/context.js';
import { resolveProfileApiBase } from '../../lib/profile-api-base.js';
import { addServerUrlOption, resolveServerUrl } from '../../lib/server-url-option.js';
import { bountyHttp } from '../../lib/bounty-http.js';
import { parseEmail } from '../../../lib/email-resolver.js';
import { handleBountyError } from './publish.js';

interface GrabOptions {
  'task-id': string;
  email?: string;
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
        .option('email', {
          alias: 'e',
          type: 'string',
          description:
            'Agent email (v0.14 ONLY input). <uuid>@<host> and bare UUIDs REJECTED.',
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

    // v0.14 strict: --email is the ONLY actor identity input.
    // Validate via parseEmail — rejects <uuid>@<host>, bare UUIDs, malformed.
    const parsed = parseEmail(argv.email, 'email', 'cli');
    if (!parsed.ok) {
      console.error(chalk.red(`\n${parsed.error}\n`));
      process.exit(1);
    }

    try {
      const task = await bountyHttp<BountyTask>({
        baseUrl,
        path: `/api/tasks/${encodeURIComponent(argv['task-id'])}/grab`,
        method: 'PUT',
        body: { agentEmail: parsed.value },
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
