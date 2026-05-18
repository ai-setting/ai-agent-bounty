/**
 * server status command
 * Show bounty server status
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';

const SERVER_PORT = process.env.BOUNTY_PORT || '4000';
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

export const statusCommand: CommandModule = {
  command: 'status',
  describe: 'Show bounty server status',

  handler: async () => {
    console.log(chalk.cyan('\n📊 Server Status'));

    try {
      const response = await fetch(`${SERVER_URL}/api/health`);

      if (response.ok) {
        const data = await response.json() as {
          status?: string;
          uptime?: number;
          version?: string;
        };

        console.log(chalk.green('\n✓ Server is running'));
        console.log(chalk.cyan('  URL:'), SERVER_URL);
        console.log(chalk.cyan('  Port:'), SERVER_PORT);
        
        if (data.version) {
          console.log(chalk.cyan('  Version:'), data.version);
        }
        
        if (data.uptime) {
          const hours = Math.floor(data.uptime / 3600);
          const minutes = Math.floor((data.uptime % 3600) / 60);
          console.log(chalk.cyan('  Uptime:'), `${hours}h ${minutes}m`);
        }

        console.log('\nAvailable endpoints:');
        console.log(`  ${SERVER_URL}/api/health`);
        console.log(`  ${SERVER_URL}/api/agents`);
        console.log(`  ${SERVER_URL}/api/tasks`);
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
