/**
 * server start command
 * Start the bounty server
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { CLI_PORT, CLI_SERVER_URL } from '../../config-env.js';

export const startCommand: CommandModule = {
  command: 'start',
  describe: 'Start the bounty server',
  
  builder: (yargs) =>
    yargs
      .option('port', {
        alias: 'p',
        type: 'string',
        description: 'Server port (BOUNTY_PORT)',
        default: CLI_PORT,
      })
      .option('detach', {
        alias: 'd',
        type: 'boolean',
        description: 'Run server in background',
        default: true,
      }),

  handler: async (argv) => {
    const port = argv.port as string;
    const detach = argv.detach as boolean;
    const serverUrl = `http://localhost:${port}`;

    console.log(chalk.cyan('\n🚀 Starting bounty server...'));

    // Check if server is already running
    try {
      const response = await fetch(`${serverUrl}/health`);
      if (response.ok) {
        console.log(chalk.yellow(`\n⚠ Server is already running on port ${port}`));
        return;
      }
    } catch {
      // Server not running, continue
    }

    // Find the server entry point
    const possiblePaths = [
      join(process.cwd(), 'dist', 'server', 'server.js'),
      join(process.cwd(), 'src', 'server', 'server.ts'),
    ];

    let serverPath = '';
    for (const p of possiblePaths) {
      if (existsSync(p)) {
        serverPath = p;
        break;
      }
    }

    if (!serverPath) {
      console.error(chalk.red('\n✗ Server entry point not found.\n'));
      console.error('  Please run "bun run build" first, or use "bun run dev" to start in development mode.\n');
      process.exit(1);
    }

    const env = {
      ...process.env,
      BOUNTY_PORT: port,
    };

    if (detach) {
      // Start server in background
      const child = spawn('bun', ['run', serverPath], {
        env,
        detached: true,
        stdio: 'ignore',
      });

      child.unref();

      // Wait for server to start
      console.log(chalk.cyan('  Starting in background...'));
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check if started successfully
      try {
        const response = await fetch(`${serverUrl}/health`);
        if (response.ok) {
          console.log(chalk.green('\n✓ Server started successfully!'));
          console.log(chalk.cyan('  HTTP/WS:'), `ws://localhost:${port}/ws`);
          console.log(chalk.cyan('  Health:'), `${serverUrl}/health`);
          console.log('\nNext steps:');
          console.log(`  ${chalk.gray('bounty auth register --email <email> --name <name>')}`);
          return;
        }
      } catch {
        // Ignore
      }

      console.log(chalk.yellow('\n⚠ Server starting in background'));
      console.log(chalk.cyan('  Check status with:'), 'bounty server status');
    } else {
      // Start server in foreground
      console.log(chalk.cyan('\n  Press Ctrl+C to stop\n'));
      
      const child = spawn('bun', ['run', serverPath], {
        env,
        stdio: 'inherit',
      });

      child.on('exit', (code) => {
        if (code !== 0) {
          console.error(chalk.red(`\n✗ Server exited with code ${code}\n`));
          process.exit(code || 1);
        }
      });
    }
  },
};
