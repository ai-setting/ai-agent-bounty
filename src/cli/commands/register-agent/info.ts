/**
 * agent info command — v0.14 STRICT email-only.
 *
 * v0.10 BREAKING: --id / -i REMOVED. Use --agent-address <uuid>@<host>.
 * v0.14 BREAKING: --agent-address / -a REMOVED. Use --email / -e only.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';
import {
  requireEmailFlag,
  exitWithEmailFlagError,
} from '../../lib/email-flag.js';

interface InfoOptions {
  email?: string;
}

export const infoCommand: CommandModule<object, InfoOptions> = {
  command: 'info',
  describe: 'Get detailed information about an agent (v0.14 STRICT: --email only).',

  builder: (yargs) =>
    yargs.option('email', {
      alias: 'e',
      type: 'string',
      description:
        'Agent email (v0.14 ONLY input). <uuid>@<host> and bare UUIDs REJECTED.',
    }),

  handler: async (argv) => {
    const parsed = requireEmailFlag(
      'email',
      argv as Record<string, unknown>,
    );
    if (!parsed.ok) {
      exitWithEmailFlagError(parsed);
    }
    const email = parsed.value;

    const ctx = createContext();

    try {
      const agent = ctx.agentService.getByEmail(email);

      if (!agent) {
        console.error(chalk.red(`\n✗ Error: no agent registered for email ${email}\n`));
        ctx.db.close();
        process.exit(1);
      }

      console.log(chalk.bold('\nAgent Info:\n'));
      console.log(chalk.cyan('  ID:'), agent.id);
      console.log(chalk.cyan('  Name:'), agent.name);
      console.log(chalk.cyan('  Email:'), agent.email);
      if (agent.description) {
        console.log(chalk.cyan('  Description:'), agent.description);
      }
      console.log(chalk.cyan('  Credits:'), agent.credits);
      console.log(chalk.cyan('  Status:'), agent.status);
      console.log(
        chalk.cyan('  Created:'),
        new Date(agent.createdAt).toLocaleString(),
      );
      console.log();

      ctx.db.close();
    } catch (error: any) {
      console.error(chalk.red('\n✗ Error:'), error.message);
      ctx.db.close();
      process.exit(1);
    }
  },
};
