/**
 * bounty submit command
 *
 * v0.10: STRICT address-based agent identity (`<uuid>@<host>` required).
 * Bare UUID and `--agent-id` flag REMOVED (BREAKING).
 *
 * v0.13: --email is the PRIMARY lookup key; --agent-address remains as a
 *   backward-compatible secondary option. At least one is required.
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

interface SubmitOptions {
  'task-id': string;
  'agent-address'?: string;
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
          description: 'Agent email (v0.13 primary; preferred over --agent-address)',
        })
        .option('agent-address', {
          alias: 'a',
          type: 'string',
          description:
            'Agent address in <uuid>@<host> format [LEGACY: prefer --email in v0.13]. ' +
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
    const profile = ProfileContext.getActive();
    const baseUrl = resolveProfileApiBase({
      cliServerUrl: argv['server-url'] as string | undefined,
      fallbackApiBase: API_BASE,
      profile,
      resolveServerUrlFn: resolveServerUrl,
    });

    // v0.13: email takes priority; falls back to address parser.
    const body: Record<string, unknown> = { result: argv.result };
    if (argv.email) {
      body.agentEmail = argv.email;
    } else {
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

    if (!argv.result || !argv.result.trim()) {
      console.error(chalk.red('\n✗ --result cannot be empty.\n'));
      process.exit(2);
    }

    try {
      const task = await bountyHttp<BountyTask>({
        baseUrl,
        path: `/api/tasks/${encodeURIComponent(argv['task-id'])}/submit`,
        method: 'PUT',
        body,
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
