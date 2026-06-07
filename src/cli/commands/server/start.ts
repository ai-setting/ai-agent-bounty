/**
 * server start command
 * Start the bounty server
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { bountyConfig } from '../../../lib/config/bounty-config.js';

const MAX_PORT = 65535;
const MIN_PORT = 1;
const HEALTH_POLL_ATTEMPTS = 20;
const HEALTH_POLL_INTERVAL_MS = 250;

/**
 * Returns true when `value` is a string that can be parsed into a
 * port number in the range 1..65535.
 */
export function isValidPort(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^\d+$/.test(value)) return false;
  const n = Number(value);
  return Number.isInteger(n) && n >= MIN_PORT && n <= MAX_PORT;
}

/**
 * Parses a port string and returns the integer value, or null when
 * the value is not a valid 1..65535 port.
 */
export function parsePort(value: string): number | null {
  if (!isValidPort(value)) return null;
  return Number(value);
}

export const startCommand: CommandModule = {
  command: 'start',
  describe: 'Start the bounty server',

  builder: (yargs) =>
    yargs
      .option('port', {
        alias: 'p',
        type: 'string',
        description: 'Server port (BOUNTY_PORT)',
        default: String(bountyConfig.port),
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

    if (!isValidPort(port)) {
      console.error(
        chalk.red(
          `\n✗ Invalid port: "${port}". Must be an integer between ${MIN_PORT} and ${MAX_PORT}.\n`
        )
      );
      process.exit(2);
    }

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

    // Always pass the port as a string in BOUNTY_PORT; BountyConfig
    // already does parseInt() and the server reads BOUNTY_PORT as a
    // string. The previous code happened to work because Bun's spawn
    // was permissive, but we normalize to a numeric string here so the
    // child's environment is consistent.
    const env = {
      ...process.env,
      BOUNTY_PORT: String(port),
    };

    if (detach) {
      // Start server in background
      const child = spawn('bun', ['run', serverPath], {
        env,
        detached: true,
        stdio: 'ignore',
      });

      child.unref();

      // Poll /health for up to HEALTH_POLL_ATTEMPTS * HEALTH_POLL_INTERVAL_MS.
      // This avoids the previous race where a single 2s sleep was too
      // short on slow CI and missed the readiness window entirely.
      console.log(chalk.cyan('  Starting in background...'));
      const started = await waitForHealth(serverUrl, HEALTH_POLL_ATTEMPTS, HEALTH_POLL_INTERVAL_MS);

      if (started) {
        console.log(chalk.green('\n✓ Server started successfully!'));
        console.log(chalk.cyan('  HTTP/WS:'), `ws://localhost:${port}/ws`);
        console.log(chalk.cyan('  Health:'), `${serverUrl}/health`);
        console.log('\nNext steps:');
        console.log(`  ${chalk.gray('bounty auth register --email <email> --name <name>')}`);
        return;
      }

      console.log(chalk.yellow('\n⚠ Server is still starting (health check timed out)'));
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

/**
 * Polls the server's /health endpoint until it returns 2xx, or
 * `attempts` × `intervalMs` milliseconds have elapsed.
 *
 * Exported for unit testing.
 */
export async function waitForHealth(
  url: string,
  attempts: number,
  intervalMs: number
): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return true;
    } catch {
      // server not yet accepting connections
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  return false;
}
