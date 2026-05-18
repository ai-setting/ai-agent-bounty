/**
 * server status command
 * Show bounty server status
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { CLI_PORT } from '../../config-env.js';

export const statusCommand: CommandModule = {
  command: 'status',
  describe: 'Show bounty server status',

  handler: async () => {
    const port = CLI_PORT;
    const serverUrl = `http://localhost:${port}`;

    console.log(chalk.cyan('\n📊 Server Status'));
    console.log(chalk.gray(`  Port: ${port}`));

    try {
      const response = await fetch(`${serverUrl}/health`);

      if (response.ok) {
        const data = await response.json() as {
          status?: string;
          timestamp?: number;
        };

        console.log(chalk.green('\n✓ Server is running'));
        console.log(chalk.cyan('  HTTP:'), serverUrl);
        console.log(chalk.cyan('  WebSocket:'), `ws://localhost:${port}/ws`);
        
        if (data.timestamp) {
          console.log(chalk.cyan('  Uptime check:'), new Date(data.timestamp).toLocaleString());
        }

        console.log('\nEndpoints:');
        console.log(`  ${serverUrl}/           # Server info`);
        console.log(`  ${serverUrl}/health      # Health check`);
        console.log(`  ${serverUrl}/api/auth/*  # Auth API`);
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
