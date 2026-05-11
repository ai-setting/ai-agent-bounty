/**
 * IM CLI - Inbox Command
 */

import type { CommandModule } from 'yargs';

interface InboxOptions {
  address: string;
  host?: string;
  port?: number;
}

export const InboxCommand: CommandModule<object, InboxOptions> = {
  command: ['inbox', 'i'],
  describe: 'Get messages from an agent inbox',
  builder: (yargs) =>
    yargs
      .option('address', {
        alias: 'a',
        type: 'string',
        description: 'Agent address (format: agent-id@host)',
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
    const { address, host, port } = args;
    const url = `http://${host}:${port}/messages?address=${encodeURIComponent(address)}`;
    
    try {
      const response = await fetch(url);
      
      if (response.ok) {
        const messages = await response.json() as any[];
        if (messages.length === 0) {
          console.log('No messages in inbox');
        } else {
          console.log(`${messages.length} message(s) found:\n`);
          for (const msg of messages) {
            console.log(`[${msg.id}]`);
            console.log(`  From: ${msg.from}`);
            console.log(`  To: ${msg.to}`);
            console.log(`  Status: ${msg.status}`);
            console.log(`  Created: ${new Date(msg.createdAt).toLocaleString()}`);
            if (msg.content?.type === 'text') {
              console.log(`  Content: ${msg.content.body}`);
            }
            console.log();
          }
        }
      } else {
        console.error(`✗ Failed to get inbox (${response.status})`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`✗ Error getting inbox`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
};
