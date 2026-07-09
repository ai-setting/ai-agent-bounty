/**
 * agent get command
 * Get details of a specific agent by ID
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
import { loadToken } from '../../storage.js';
// v0.5.0: TLS skip default — use bountyFetch wrapper
import { bountyFetch } from '../../lib/fetch-helper.js';

import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../lib/server-url-option.js';

interface GetAgentOptions {
  id: string;
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

export const getCommand: CommandModule = {
  command: 'get',
  describe: 'Get details of a specific agent by ID',

  builder: (yargs) =>
    addServerUrlOption(
      yargs.option('id', {
        alias: 'i',
        type: 'string',
        demandOption: true,
        description: 'Agent ID',
      })
    ),

  handler: async (argv) => {
    const options = argv as unknown as GetAgentOptions;

    try {
      // Try to load token
      let token = await loadToken();

      // If no token, prompt for login
      if (!token) {
        console.log(chalk.yellow('\n⚠ No token found. Please login first.\n'));
        console.log(chalk.cyan('  bounty register-agent login --email <your-email>\n'));
        process.exit(1);
      }

      const baseUrl = resolveServerUrl(options['server-url'], API_BASE);

      const response = await bountyFetch(`${baseUrl}/api/agents/${options.id}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.status === 401) {
        // Token expired, try to refresh via login
        console.log(chalk.yellow('\n⚠ Token expired. Please login again.\n'));
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
