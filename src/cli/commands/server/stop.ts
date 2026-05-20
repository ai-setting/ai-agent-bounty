/**
 * server stop command
 * Stop the bounty server
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { bountyConfig } from '../../../lib/config/bounty-config.js';

export const stopCommand: CommandModule = {
  command: 'stop',
  describe: 'Stop the bounty server',

  handler: async () => {
    const port = bountyConfig.port;
    const serverUrl = `http://localhost:${port}`;

    console.log(chalk.cyan('\n🛑 Stopping bounty server...'));

    // Check if server is running
    try {
      const response = await fetch(`${serverUrl}/health`);
      if (!response.ok) {
        console.log(chalk.yellow('\n⚠ Server is not running'));
        return;
      }
    } catch {
      console.log(chalk.yellow('\n⚠ Server is not running'));
      return;
    }

    // Try graceful shutdown via API
    try {
      const response = await fetch(`${serverUrl}/api/shutdown`, {
        method: 'POST',
      });

      if (response.ok) {
        console.log(chalk.green('\n✓ Server stopped successfully'));
        return;
      }
    } catch {
      // Fall back to process kill
    }

    // Try to kill process on port
    try {
      const { execSync } = await import('child_process');
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, {
        stdio: 'ignore',
      });
      console.log(chalk.green('\n✓ Server stopped'));
    } catch {
      console.log(chalk.yellow('\n⚠ Could not stop server gracefully'));
      console.log(chalk.cyan('  Try:'), `lsof -ti:${port} | xargs kill -9`);
    }
  },
};
