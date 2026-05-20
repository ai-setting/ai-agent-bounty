/**
 * com send command
 * Send message via Agent IM
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { bountyConfig } from '../../../lib/config/bounty-config.js';

interface SendOptions {
  from: string;
  to: string;
  body: string;
  host?: string;
  port?: number;
}

export const sendCommand: CommandModule<object, SendOptions> = {
  command: ['send', 's'],
  describe: 'Send a message via Agent IM',
  
  builder: (yargs) =>
    yargs
      .option('from', {
        alias: 'f',
        type: 'string',
        demandOption: true,
        description: 'Sender address (format: agent-id@host)',
      })
      .option('to', {
        alias: 't',
        type: 'string',
        demandOption: true,
        description: 'Recipient address (format: agent-id@host)',
      })
      .option('body', {
        alias: 'b',
        type: 'string',
        demandOption: true,
        description: 'Message body',
      })
      .option('host', {
        alias: 'H',
        type: 'string',
        description: 'IM server host',
        default: bountyConfig.host,
      })
      .option('port', {
        alias: 'p',
        type: 'number',
        description: 'IM server port',
        default: bountyConfig.port,
      }),

  handler: async (args) => {
    const { from, to, body, host, port } = args;
    const url = `http://${host}:${port}/messages`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to,
          content: { type: 'text', body },
        }),
      });
      
      if (response.ok) {
        const message = await response.json() as any;
        console.log(chalk.green('\n✓ Message sent successfully\n'));
        console.log(chalk.cyan('  ID:'), message.id);
        console.log(chalk.cyan('  From:'), message.from);
        console.log(chalk.cyan('  To:'), message.to);
        console.log();
      } else {
        const error = await response.text();
        console.error(chalk.red(`\n✗ Failed to send message (${response.status})`));
        console.error(error);
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('\n✗ Error sending message:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
};
