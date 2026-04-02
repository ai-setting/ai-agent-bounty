/**
 * com inbox command
 * Check inbox messages via IMAP
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';
import { AgentConfigService } from '../../../lib/com/agent-config.js';
import { ImapService } from '../../../lib/com/imap.js';

export const inboxCommand: CommandModule = {
  command: 'inbox',
  describe: 'Check inbox messages',
  
  builder: (yargs) =>
    yargs
      .option('agent-id', {
        alias: 'a',
        type: 'string',
        demandOption: true,
        description: 'Agent ID',
      })
      .option('limit', {
        alias: 'l',
        type: 'number',
        default: 10,
        description: 'Number of messages',
      })
      .option('unread', {
        alias: 'u',
        type: 'boolean',
        default: false,
        description: 'Show only unread',
      }),

  handler: async (argv) => {
    const ctx = createContext();
    const configService = new AgentConfigService(ctx.db);
    const imapService = new ImapService();

    try {
      const config = configService.getConfig(argv['agent-id'] as string);
      
      if (!config || !config.imapHost || !config.imapUser || !config.imapPassword) {
        console.error(chalk.red('\n✗ Error: IMAP not configured for this agent'));
        console.error(chalk.gray('  Run: bounty com config --agent-id <id> --imap-host <host> ...\n'));
        ctx.db.close();
        process.exit(1);
      }

      console.log(chalk.cyan('\nFetching messages...\n'));

      const messages = await imapService.fetchMessages(
        {
          host: config.imapHost,
          port: config.imapPort,
          user: config.imapUser,
          password: config.imapPassword,
          tls: config.imapTls,
        },
        {
          limit: argv.limit as number,
          unreadOnly: argv.unread as boolean,
        }
      );

      if (messages.length === 0) {
        console.log(chalk.yellow('No messages found.\n'));
      } else {
        console.log(chalk.bold(`Inbox (${messages.length} messages):\n`));
        
        messages.forEach((msg, i) => {
          console.log(chalk.cyan(`[${i + 1}] From: ${msg.from}`));
          console.log(chalk.cyan(`    Subject: ${msg.subject}`));
          console.log(chalk.gray(`    Date: ${msg.date.toLocaleString()}`));
          if (msg.body) {
            const preview = msg.body.substring(0, 100).replace(/\n/g, ' ');
            console.log(chalk.gray(`    Preview: ${preview}...`));
          }
          console.log();
        });
      }

      ctx.db.close();
    } catch (error: any) {
      console.error(chalk.red('\n✗ Error:'), error.message);
      ctx.db.close();
      process.exit(1);
    }
  },
};
