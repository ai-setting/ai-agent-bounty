/**
 * agent list command
 * List all registered agents
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
import { loadToken } from '../../storage.js';

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
}

export const listCommand: CommandModule = {
  command: 'register-agent list',
  describe: 'List all registered agents',

  builder: (yargs) =>
    yargs.option('status', {
      alias: 's',
      type: 'string',
      description: 'Filter by agent status (active, pending, suspended)',
    }),

  handler: async (argv) => {
    const options = argv as unknown as ListAgentsOptions;

    try {
      // Try to load token
      const token = await loadToken();

      if (!token) {
        console.log(chalk.yellow('\n⚠ No token found. Please login first.\n'));
        console.log(chalk.cyan('  bounty agent login --email <your-email>\n'));
        process.exit(1);
      }

      const response = await fetch(`${API_BASE}/api/agents`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.status === 401) {
        console.log(chalk.yellow('\n⚠ Token expired. Please login again.\n'));
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
