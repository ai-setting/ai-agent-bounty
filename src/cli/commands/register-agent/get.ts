/**
 * agent get command — v0.14 STRICT email-only.
 *
 * v0.10: --id / -i REMOVED. Use --agent-address <uuid>@<host>.
 * v0.13: --email introduced as PRIMARY lookup; --agent-address retained.
 * v0.14 BREAKING:
 *   - --agent-address / -a REMOVED.
 *   - --email / -e is the ONLY actor identity input.
 *   - <uuid>@<host>, bare UUIDs, malformed emails REJECTED with exit 1
 *     and a clear "use --email" hint.
 *   - Falls back to active profile's email when no explicit flag.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
import { bountyFetch } from '../../lib/fetch-helper.js';
import { attachSoftAuth } from '../../lib/soft-auth.js';
import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../lib/server-url-option.js';
import {
  requireEmailFlag,
  exitWithEmailFlagError,
} from '../../lib/email-flag.js';

interface GetAgentOptions {
  email?: string;
  'server-url'?: string;
}

interface Agent {
  id: string;
  name: string;
  email: string;
  status: string;
  credits: number;
  address?: string;
  description?: string;
  created_at: number;
}

export const getCommand: CommandModule<object, GetAgentOptions> = {
  command: 'get',
  describe: 'Get details of a specific agent by email (v0.14 STRICT: --email only).',

  builder: (yargs) =>
    addServerUrlOption(
      yargs.option('email', {
        alias: 'e',
        type: 'string',
        description:
          'Agent email (v0.14 ONLY input). <uuid>@<host> and bare UUIDs REJECTED.',
      })
    ),

  handler: async (argv) => {
    const parsed = requireEmailFlag(
      'email',
      argv as Record<string, unknown>,
    );
    if (!parsed.ok) {
      exitWithEmailFlagError(parsed);
    }
    const email = parsed.value;

    try {
      const baseUrl = resolveServerUrl(
        argv['server-url'] as string | undefined,
        API_BASE,
      );
      const auth = attachSoftAuth({});

      // v0.14: lookup is exclusively via /api/agents/by-email?email=<email>.
      const url = `${baseUrl}/api/agents/by-email?email=${encodeURIComponent(email)}`;

      const response = await bountyFetch(url, {
        method: 'GET',
        headers: auth.headers,
      });

      if (response.status === 401) {
        console.log(
          chalk.yellow('\n⚠ Unauthorized. Please login if this endpoint requires a token.\n'),
        );
        process.exit(1);
      }

      const data = (await response.json()) as Agent | { error: string };

      if (!response.ok) {
        console.error(
          chalk.red(
            `\n✗ Error: ${(data as { error: string }).error || 'Failed to get agent'}\n`,
          ),
        );
        process.exit(1);
      }

      const agent = data as Agent;

      console.log(chalk.bold('\nAgent Details:\n'));
      console.log(chalk.cyan('  ID:'), agent.id);
      console.log(chalk.cyan('  Name:'), agent.name);
      console.log(chalk.cyan('  Email:'), agent.email);
      console.log(chalk.cyan('  Status:'), agent.status);
      console.log(chalk.cyan('  Credits:'), agent.credits);
      if (agent.address) {
        console.log(chalk.cyan('  Address:'), agent.address);
      }
      if (agent.description) {
        console.log(chalk.cyan('  Description:'), agent.description);
      }
      console.log(chalk.cyan('  Created:'), new Date(agent.created_at).toISOString());
      console.log();
    } catch (error) {
      console.error(
        chalk.red(
          `\n✗ Error: ${error instanceof Error ? error.message : 'Failed to get agent'}\n`,
        ),
      );
      process.exit(1);
    }
  },
};
