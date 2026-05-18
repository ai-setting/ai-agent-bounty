/**
 * server status command
 * Show bounty server status
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { CLI_SERVER_PORT, CLI_API_BASE } from '../../config-env.js';

export const statusCommand: CommandModule = {
  command: 'status',
  describe: 'Show bounty server status',

  handler: async () => {
    const port = CLI_SERVER_PORT;
    const serverUrl = `http://localhost:${port}`;

    console.log(chalk.cyan('\n📊 Server Status'));
    console.log(chalk.gray(`  Configured API_BASE: ${CLI_API_BASE}`));
    console.log(chalk.gray(`  Checking port: ${port}`));

    try {
      const response = await fetch(`${serverUrl}/api/health`);

      if (response.ok) {
        const data = await response.json() as {
          status?: string;
          uptime?: number;
          version?: string;
        };

        console.log(chalk.green('\n✓ Server is running'));
        console.log(chalk.cyan('  URL:'), serverUrl);
        console.log(chalk.cyan('  Port:'), port);
        
        if (data.version) {
          console.log(chalk.cyan('  Version:'), data.version);
        }
        
        if (data.uptime) {
          const hours = Math.floor(data.uptime / 3600);
          const minutes = Math.floor((data.uptime % 3600) / 60);
          console.log(chalk.cyan('  Uptime:'), `${hours}h ${minutes}m`);
        }

        console.log('\nAvailable endpoints:');
        console.log(`  ${serverUrl}/api/health`);
        console.log(`  ${serverUrl}/api/agents`);
        console.log(`  ${serverUrl}/api/tasks`);
      } else {
        console.log(chalk.red('\n✗ Server is responding but not healthy'));
        console.log(chalk.cyan('  Status:'), response.status);
      }
    } catch (error) {
      console.log(chalk.red('\n✗ Server is not running'));
      console.log(chalk.cyan('  Start with:'), 'bounty server start');
    }
  },
};
