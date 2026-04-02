/**
 * com config command
 * Configure SMTP/IMAP for an agent
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';
import { AgentConfigService } from '../../../lib/com/agent-config.js';

export const configCommand: CommandModule = {
  command: 'config',
  describe: 'Configure SMTP/IMAP for an agent',
  
  builder: (yargs) =>
    yargs
      .option('agent-id', {
        alias: 'a',
        type: 'string',
        demandOption: true,
        description: 'Agent ID',
      })
      .option('smtp-host', { type: 'string', description: 'SMTP host' })
      .option('smtp-port', { type: 'number', default: 587, description: 'SMTP port' })
      .option('smtp-user', { type: 'string', description: 'SMTP user' })
      .option('smtp-pass', { type: 'string', description: 'SMTP password' })
      .option('smtp-secure', { type: 'boolean', default: false, description: 'Use TLS/SSL' })
      .option('imap-host', { type: 'string', description: 'IMAP host' })
      .option('imap-port', { type: 'number', default: 993, description: 'IMAP port' })
      .option('imap-user', { type: 'string', description: 'IMAP user' })
      .option('imap-pass', { type: 'string', description: 'IMAP password' })
      .option('imap-tls', { type: 'boolean', default: true, description: 'Use TLS' }),

  handler: async (argv) => {
    const ctx = createContext();
    const configService = new AgentConfigService(ctx.db);

    try {
      configService.saveConfig({
        agentId: argv['agent-id'] as string,
        smtpHost: argv['smtp-host'] as string | undefined,
        smtpPort: argv['smtp-port'] as number,
        smtpUser: argv['smtp-user'] as string | undefined,
        smtpPassword: argv['smtp-pass'] as string | undefined,
        smtpSecure: argv['smtp-secure'] as boolean,
        imapHost: argv['imap-host'] as string | undefined,
        imapPort: argv['imap-port'] as number,
        imapUser: argv['imap-user'] as string | undefined,
        imapPassword: argv['imap-pass'] as string | undefined,
        imapTls: argv['imap-tls'] as boolean,
      });

      console.log(chalk.green('\n✓ Configuration saved successfully\n'));

      // Show current config
      const config = configService.getConfig(argv['agent-id'] as string);
      if (config) {
        console.log(chalk.bold('Current Configuration:\n'));
        
        if (config.smtpHost) {
          console.log(chalk.cyan('  SMTP:'));
          console.log(chalk.gray(`    Host: ${config.smtpHost}:${config.smtpPort}`));
          console.log(chalk.gray(`    User: ${config.smtpUser}`));
          console.log(chalk.gray(`    Secure: ${config.smtpSecure ? 'Yes' : 'No'}`));
        } else {
          console.log(chalk.gray('  SMTP: Not configured'));
        }

        if (config.imapHost) {
          console.log(chalk.cyan('  IMAP:'));
          console.log(chalk.gray(`    Host: ${config.imapHost}:${config.imapPort}`));
          console.log(chalk.gray(`    User: ${config.imapUser}`));
          console.log(chalk.gray(`    TLS: ${config.imapTls ? 'Yes' : 'No'}`));
        } else {
          console.log(chalk.gray('  IMAP: Not configured'));
        }
        console.log();
      }

      ctx.db.close();
    } catch (error: any) {
      console.error(chalk.red('\n✗ Error:'), error.message);
      ctx.db.close();
      process.exit(1);
    }
  },
};
