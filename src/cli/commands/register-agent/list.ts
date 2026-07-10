/**
 * agent list command
 * List all registered agents
 *
 * v0.7: soft auth. A saved token is attached when present, but a missing
 * local token no longer prevents the request from reaching the server.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
// v0.5.0: TLS skip default — use bountyFetch wrapper
import { bountyFetch } from '../../lib/fetch-helper.js';
import { attachSoftAuth } from '../../lib/soft-auth.js';

import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../lib/server-url-option.js';

interface Agent {
  id: string;
  name: string;
  email: string;
  status: string;
  credits: number;
  address?: string;
  created_at: number;
}

interface ListAgentsOptions {
  status?: string;
  'server-url'?: string;
}

export const listCommand: CommandModule<object, ListAgentsOptions> = {
  command: 'list',
  describe: 'List all registered agents',

  builder: (yargs) =>
    addServerUrlOption(
      yargs.option('status', {
        alias: 's',
        type: 'string',
        description: 'Filter by agent status (active, pending, suspended)',
      })
    ),

  handler: async (argv) => {
    const options = argv as unknown as ListAgentsOptions;

    try {
      const baseUrl = resolveServerUrl(options['server-url'], API_BASE);
      const auth = attachSoftAuth({});

      const response = await bountyFetch(`${baseUrl}/api/agents`, {
        method: 'GET',
        headers: auth.headers,
      });

      if (response.status === 401) {
        console.log(chalk.yellow('\n⚠ Unauthorized. Please login if this endpoint requires a token.\n'));
        process.exit(1);
      }

      let agents = await response.json() as Agent[];

      if (!response.ok) {
        console.error(chalk.red(`\n✗ Error: ${(agents as any).error || 'Failed to list agents'}\n`));
        process.exit(1);
      }

      // Filter by status if specified
      if (options.status) {
        agents = agents.filter((a) => a.status === options.status);
      }

      if (agents.length === 0) {
        console.log(chalk.yellow('\nNo agents found.\n'));
        return;
      }

      console.log(chalk.bold(`\nAgents (${agents.length}):\n`));

      agents.forEach((agent) => {
        const statusColor = agent.status === 'active'
          ? chalk.green
          : agent.status === 'pending'
            ? chalk.yellow
            : chalk.red;

        console.log(chalk.cyan(`  ${agent.name} (${agent.email})`));
        console.log(chalk.gray(`    ID: ${agent.id}`));
        console.log(chalk.gray(`    Status:`), statusColor(agent.status));
        console.log(chalk.gray(`    Credits: ${agent.credits}`));
        if (agent.address) {
          console.log(chalk.gray(`    Address: ${agent.address}`));
        }
        console.log();
      });
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : 'Failed to list agents'}\n`));
      process.exit(1);
    }
  },
};
