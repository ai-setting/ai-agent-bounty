/**
 * com connect command
 * Start IMAP IDLE monitoring in background
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';
import { AgentConfigService } from '../../../lib/com/agent-config.js';
import { IdleService } from '../../../lib/com/idle.js';

// Store active idle services
export const activeIdleServices: Map<string, IdleService> = new Map();

export const connectCommand: CommandModule = {
  command: 'connect',
  describe: 'Start IMAP IDLE monitoring for real-time email notifications',
  
  builder: (yargs) =>
    yargs
      .option('agent-id', {
        alias: 'a',
        type: 'string',
        demandOption: true,
        description: 'Agent ID',
      })
      .option('daemon', {
        alias: 'd',
        type: 'boolean',
        default: false,
        description: 'Run as background daemon',
      }),

  handler: async (argv) => {
    const ctx = createContext();
    const configService = new AgentConfigService(ctx.db);

    try {
      const config = configService.getConfig(argv['agent-id'] as string);
      
      if (!config || !config.imapHost || !config.imapUser || !config.imapPassword) {
        console.error(chalk.red('\n✗ Error: IMAP not configured for this agent'));
        console.error(chalk.gray('  Run: bounty com config --agent-id <id> --imap-host <host> ...\n'));
        ctx.db.close();
        process.exit(1);
      }

      // Check if already connected
      if (activeIdleServices.has(argv['agent-id'] as string)) {
        console.log(chalk.yellow('\n⚠ Already connected for this agent\n'));
        ctx.db.close();
        return;
      }

      const idleService = new IdleService();

      await idleService.start(
        {
          host: config.imapHost,
          port: config.imapPort,
          user: config.imapUser,
          password: config.imapPassword,
          tls: config.imapTls,
        },
        (mail) => {
          console.log(chalk.green('\n📧 [NEW MAIL]'));
          console.log(chalk.cyan(`  From: ${mail.from}`));
          console.log(chalk.cyan(`  Subject: ${mail.subject}`));
          console.log(chalk.cyan(`  Date: ${mail.date.toLocaleString()}`));
          if (mail.body) {
            const preview = mail.body.substring(0, 200).replace(/\n/g, ' ');
            console.log(chalk.gray(`  Preview: ${preview}...`));
          }
          console.log();
        }
      );

      activeIdleServices.set(argv['agent-id'] as string, idleService);

      console.log(chalk.green('\n✓ Connected and listening for emails\n'));
      console.log(chalk.cyan('  Agent ID:'), argv['agent-id']);
      console.log(chalk.cyan('  IMAP:'), `${config.imapHost}:${config.imapPort}`);
      console.log();

      if (!argv['daemon']) {
        console.log(chalk.gray('Press Ctrl+C to stop...\n'));

        // Handle shutdown
        const shutdown = () => {
          idleService.stop();
          activeIdleServices.delete(argv['agent-id'] as string);
          ctx.db.close();
          process.exit(0);
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
      } else {
        ctx.db.close();
      }
    } catch (error: any) {
      console.error(chalk.red('\n✗ Error:'), error.message);
      ctx.db.close();
      process.exit(1);
    }
  },
};
