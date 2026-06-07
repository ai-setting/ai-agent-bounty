/**
 * com connect command
 *
 * STUB: this command does NOT open a persistent WebSocket or
 * IMAP IDLE session. It just probes the configured IM server
 * to confirm the address is reachable, then prints a
 * placeholder notice. Use the long-running IM HTTP/WebSocket
 * flow via the integrated server for live delivery.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { bountyConfig } from '../../../lib/config/bounty-config.js';
import { printStubNotice } from './stub.js';

interface ConnectOptions {
  address: string;
  host?: string;
  port?: number;
}

export const connectCommand: CommandModule<object, ConnectOptions> = {
  command: ['connect', 'conn'],
  describe: 'Probe the Agent IM server (placeholder, no persistent connection)',

  builder: (yargs) =>
    yargs
      .option('address', {
        alias: 'a',
        type: 'string',
        demandOption: true,
        description: 'Your address (format: agent-id@host)',
      })
      .option('host', {
        alias: 'H',
        type: 'string',
        description: 'IM server host (default: localhost)',
        default: 'localhost',
      })
      .option('port', {
        alias: 'p',
        type: 'number',
        description: 'IM server port',
        default: bountyConfig.port,
      }),

  handler: async (args) => {
    const { address, host, port } = args;
    const wsUrl = `ws://${host}:${port}/ws?address=${encodeURIComponent(address)}`;

    console.log(chalk.bold('\n🔗 Probing Agent IM server...\n'));
    console.log(chalk.gray('  Address:'), address);
    console.log(chalk.gray('  Server:'), `ws://${host}:${port}/ws`);
    console.log(chalk.gray('  Port:'), port, chalk.gray('(from BOUNTY_PORT)'));
    console.log();

    try {
      const ws = new WebSocket(wsUrl);

      const connected = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve(false);
        }, 5000);

        ws.onopen = () => {
          clearTimeout(timeout);
          ws.close();
          resolve(true);
        };

        ws.onerror = () => {
          clearTimeout(timeout);
        };
      });

      if (connected) {
        console.log(chalk.green('✓ Server is reachable\n'));
      } else {
        console.log(chalk.yellow('⚠ Server did not respond within 5s\n'));
        console.log(chalk.gray('  The server may be unreachable or the address format may be invalid.\n'));
      }
    } catch (error) {
      console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    printStubNotice('connect', { address, host, port });
  },
};

/**
 * Active WebSocket connections (for reference)
 */
export const activeIdleServices: Map<string, WebSocket> = new Map();
