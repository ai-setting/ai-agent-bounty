/**
 * agent get command
 * Get details of a specific agent by address
 *
 * v0.7: prefer --agent-address (<uuid>@<host>); legacy --id remains
 * accepted and is translated to the server's agent id path segment.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
// v0.5.0: TLS skip default — use bountyFetch wrapper
import { bountyFetch } from '../../lib/fetch-helper.js';
import { resolveAgentIdOption } from '../../lib/address-parser.js';
import { attachSoftAuth } from '../../lib/soft-auth.js';

import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../lib/server-url-option.js';

interface GetAgentOptions {
  'agent-address'?: string;
  /** @deprecated Use --agent-address. */
  id?: string;
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
  describe: 'Get details of a specific agent by address',

  builder: (yargs) =>
    addServerUrlOption(
      yargs
        .option('agent-address', {
          alias: 'a',
          type: 'string',
          description: 'Agent address (<uuid>@<host>). Pure <uuid> is also accepted.',
        })
        .option('id', {
          alias: 'i',
          type: 'string',
          description: '[deprecated] Agent ID. Use --agent-address instead.',
        })
    ),

  handler: async (argv) => {
    const options = argv as unknown as GetAgentOptions & { id?: string };

    try {
      const resolvedAgent = resolveAgentIdOption({
        address: options['agent-address'],
        deprecatedId: options.id,
        addressFlag: '--agent-address',
        deprecatedFlag: '--id',
        missingMessage: '✗ --agent-address is required',
      });
      if (!resolvedAgent.ok) {
        console.error(chalk.red(`\n${resolvedAgent.error}\n`));
        process.exit(2);
      }
      options.id = resolvedAgent.value;

      const baseUrl = resolveServerUrl(options['server-url'], API_BASE);
      const auth = attachSoftAuth({});

      const response = await bountyFetch(`${baseUrl}/api/agents/${options.id}`, {
        method: 'GET',
        headers: auth.headers,
      });

      if (response.status === 401) {
        // Server may still require auth for some deployments.
        console.log(chalk.yellow('\n⚠ Unauthorized. Please login if this endpoint requires a token.\n'));
        process.exit(1);
      }

      const data = await response.json() as Agent | { error: string };

      if (!response.ok) {
        console.error(chalk.red(`\n✗ Error: ${(data as { error: string }).error || 'Failed to get agent'}\n`));
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
      console.log(chalk.cyan('  Created:'), new Date(agent.created_at).toLocaleString());
      console.log();
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : 'Failed to get agent'}\n`));
      process.exit(1);
    }
  },
};
