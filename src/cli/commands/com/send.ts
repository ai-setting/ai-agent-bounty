/**
 * com send command
 * Send email via SMTP
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';
import { AgentConfigService } from '../../../lib/com/agent-config.js';
import { SmtpService } from '../../../lib/com/smtp.js';

export const sendCommand: CommandModule = {
  command: 'send',
  describe: 'Send an email',
  
  builder: (yargs) =>
    yargs
      .option('from', {
        alias: 'f',
        type: 'string',
        demandOption: true,
        description: 'Sender address',
      })
      .option('to', {
        alias: 't',
        type: 'string',
        demandOption: true,
        description: 'Recipient address',
      })
      .option('subject', {
        alias: 's',
        type: 'string',
        demandOption: true,
        description: 'Email subject',
      })
      .option('body', {
        alias: 'b',
        type: 'string',
        demandOption: true,
        description: 'Email body',
      })
      .option('agent-id', {
        alias: 'a',
        type: 'string',
        demandOption: true,
        description: 'Agent ID (uses configured SMTP)',
      }),

  handler: async (argv) => {
    const ctx = createContext();
    const configService = new AgentConfigService(ctx.db);
    const smtpService = new SmtpService();

    try {
      const config = configService.getConfig(argv['agent-id'] as string);
      
      if (!config || !config.smtpHost || !config.smtpUser || !config.smtpPassword) {
        console.error(chalk.red('\n✗ Error: SMTP not configured for this agent'));
        console.error(chalk.gray('  Run: bounty com config --agent-id <id> --smtp-host <host> ...\n'));
        ctx.db.close();
        process.exit(1);
      }

      const result = await smtpService.send(
        {
          host: config.smtpHost,
          port: config.smtpPort,
          user: config.smtpUser,
          password: config.smtpPassword,
          secure: config.smtpSecure,
        },
        {
          from: argv.from as string,
          to: argv.to as string,
          subject: argv.subject as string,
          text: argv.body as string,
        }
      );

      if (result.success) {
        console.log(chalk.green('\n✓ Email sent successfully\n'));
        console.log(chalk.cyan('  From:'), argv.from);
        console.log(chalk.cyan('  To:'), argv.to);
        console.log(chalk.cyan('  Subject:'), argv.subject);
        console.log(chalk.cyan('  Message ID:'), result.messageId);
        console.log();
      } else {
        console.error(chalk.red('\n✗ Failed to send email:'), result.error);
        ctx.db.close();
        process.exit(1);
      }

      ctx.db.close();
    } catch (error: any) {
      console.error(chalk.red('\n✗ Error:'), error.message);
      ctx.db.close();
      process.exit(1);
    }
  },
};
