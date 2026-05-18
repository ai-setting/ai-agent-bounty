/**
 * com inbox command
 * Check inbox messages via Agent IM
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { CLI_PORT } from '../../config-env.js';

interface InboxOptions {
  address: string;
  host?: string;
  port?: number;
  limit?: number;
}

export const inboxCommand: CommandModule<object, InboxOptions> = {
  command: ['inbox', 'i'],
  describe: 'Check inbox messages via Agent IM',
  
  builder: (yargs) =>
    yargs
      .option('address', {
        alias: 'a',
        type: 'string',
        demandOption: true,
        description: 'Agent address (format: agent-id@host)',
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
        description: 'IM server port (default: from BOUNTY_PORT)',
        default: parseInt(CLI_PORT, 10),
      })
      .option('limit', {
        alias: 'l',
        type: 'number',
        description: 'Number of messages to show',
        default: 10,
      }),

  handler: async (args) => {
    const { address, host, port, limit } = args;
    const url = `http://${host}:${port}/messages?address=${encodeURIComponent(address)}`;
    
    try {
      const response = await fetch(url);
      
      if (response.ok) {
        const messages = await response.json() as any[];
        
        if (messages.length === 0) {
          console.log(chalk.yellow('\nNo messages in inbox.\n'));
        } else {
          const displayMessages = messages.slice(0, limit || 10);
          console.log(chalk.bold(`\nInbox (${messages.length} messages, showing ${displayMessages.length}):\n`));
          
          displayMessages.forEach((msg: any) => {
            const statusIcon = msg.status === 'acked' ? '✓' : msg.status === 'delivered' ? '●' : '○';
            console.log(chalk.cyan(`[${statusIcon}] From: ${msg.from}`));
            console.log(chalk.cyan(`    To: ${msg.to}`));
            if (msg.content?.type === 'text') {
              const preview = msg.content.body.substring(0, 100).replace(/\n/g, ' ');
              console.log(chalk.gray(`    ${preview}...`));
            }
            console.log(chalk.gray(`    Status: ${msg.status} | ${new Date(msg.createdAt).toLocaleString()}`));
            console.log();
          });
        }
      } else {
        console.error(chalk.red(`\n✗ Failed to get inbox (${response.status})\n`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('\n✗ Error getting inbox:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
};
