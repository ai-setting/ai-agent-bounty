/**
 * com connect command
 * Connect to Agent IM server via WebSocket
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';

interface ConnectOptions {
  address: string;
  host?: string;
  port?: number;
}

export const connectCommand: CommandModule<object, ConnectOptions> = {
  command: ['connect', 'conn'],
  describe: 'Connect to Agent IM server via WebSocket',
  
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
        description: 'IM server host',
        default: 'localhost',
      })
      .option('port', {
        alias: 'p',
        type: 'number',
        description: 'IM server port',
        default: 3001,
      }),

  handler: async (args) => {
    const { address, host, port } = args;
    const wsUrl = `ws://${host}:${port}/ws?address=${encodeURIComponent(address)}`;
    
    console.log(chalk.bold('\nConnecting to Agent IM server...\n'));
    console.log(chalk.gray('  Address:'), address);
    console.log(chalk.gray('  Server:'), `${host}:${port}`);
    console.log();
    
    try {
      // In a real CLI, this would establish a persistent WebSocket connection
      // For now, we just verify the connection is possible
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
        console.log(chalk.green('✓ Connected successfully\n'));
      } else {
        console.log(chalk.yellow('⚠ Connection timed out or failed\n'));
        console.log(chalk.gray('  The server may be unreachable or the address format may be invalid.\n'));
      }
    } catch (error) {
      console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
};

/**
 * Active WebSocket connections (for reference)
 */
export const activeIdleServices: Map<string, WebSocket> = new Map();
