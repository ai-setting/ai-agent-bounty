/**
 * bounty grab command
 *
 * v0.10: STRICT address-based agent identity (`<uuid>@<host>` required).
 * Bare UUID and `--agent-id` flag REMOVED (BREAKING).
 *
 * v0.13: --email is the PRIMARY lookup key; --agent-address remains as a
 *   backward-compatible secondary option. At least one is required.
 *
 * Phase feat/bounty-task-profile (PR7): 改用 ProfileContext 决定 API base，
 *   与 auth/* 命令族行为一致：`--server-url` > active profile.api_base > API_BASE。
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

interface GrabOptions {
  'task-id': string;
  'agent-address'?: string;
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
          description: 'Agent email (v0.13 primary; preferred over --agent-address)',
        })
        .option('agent-address', {
          alias: 'a',
          type: 'string',
          description:
            'Agent address in <uuid>@<host> format [LEGACY: prefer --email in v0.13]. ' +
            'Bare UUID is REJECTED in v0.10. Defaults to BOUNTY_IM_ADDRESS env.',
        })
        .check((argv) => {
          if (!argv.email && !argv['agent-address']) {
            // Allow env fallback for --agent-address below; only fail if no
            // fallback can be derived either. We don't validate here because
            // BOUNTY_IM_ADDRESS may still be set in env.
            return true;
          }
          return true;
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

    // v0.13: email takes priority; falls back to address parser.
    const body: Record<string, unknown> = {};
    if (argv.email) {
      body.agentEmail = argv.email;
    }
    if (!argv.email) {
      // Only parse the address when --email wasn't given.
      const agent = resolveAddressOption({
        address: argv['agent-address'],
        fallback: resolveCurrentAgentAddress(),
        addressFlag: '--agent-address',
        missingMessage:
          '✗ Cannot infer agent identity. Provide --email <email> or --agent-address <uuid>@<host> (or set BOUNTY_IM_ADDRESS=<uuid>@<host>).',
      });
      if (!agent.ok) {
        console.error(chalk.red(`\n${agent.error}\n`));
        process.exit(2);
      }
      body.agentAddress = agent.value.raw;
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
        path: `/api/tasks/${encodeURIComponent(argv['task-id'])}/grab`,
        method: 'PUT',
        body,
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
