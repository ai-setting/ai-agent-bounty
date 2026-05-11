/**
 * IM CLI - Send Message Command
 */

import type { CommandModule } from 'yargs';
import { v4 as uuidv4 } from 'uuid';

interface SendOptions {
  from: string;
  to: string;
  body: string;
  host?: string;
  port?: number;
}

export const SendCommand: CommandModule<object, SendOptions> = {
  command: ['send', 's'],
  describe: 'Send a message to another agent',
  builder: (yargs) =>
    yargs
      .option('from', {
        alias: 'f',
        type: 'string',
        description: 'Sender address (format: agent-id@host)',
        demandOption: true,
      })
      .option('to', {
        alias: 't',
        type: 'string',
        description: 'Recipient address (format: agent-id@host)',
        demandOption: true,
      })
      .option('body', {
        alias: 'b',
        type: 'string',
        description: 'Message body',
        demandOption: true,
      })
      .option('host', {
        alias: 'H',
        type: 'string',
        description: 'Server host',
        default: 'localhost',
      })
      .option('port', {
        alias: 'p',
        type: 'number',
        description: 'Server port',
        default: 3001,
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
          id: uuidv4(),
          from,
          to,
          content: { type: 'text', body },
          status: 'pending',
          createdAt: new Date().toISOString(),
        }),
      });
      
      if (response.ok) {
        const message = await response.json() as any;
        console.log('✓ Message sent successfully');
        console.log(`  ID: ${message.id}`);
        console.log(`  From: ${message.from}`);
        console.log(`  To: ${message.to}`);
      } else {
        const error = await response.text();
        console.error(`✗ Failed to send message (${response.status})`);
        console.error(error);
        process.exit(1);
      }
    } catch (error) {
      console.error(`✗ Error sending message`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
};
