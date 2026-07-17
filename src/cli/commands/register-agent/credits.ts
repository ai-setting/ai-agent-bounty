/**
 * agent credits command — v0.14 STRICT email-only.
 *
 * v0.10: --id / -i REMOVED. Use --agent-address <uuid>@<host>.
 * v0.13: --email introduced as PRIMARY lookup; --agent-address retained.
 * v0.14 BREAKING:
 *   - --agent-address / -a REMOVED.
 *   - --email / -e is the ONLY actor identity input.
 *   - <uuid>@<host>, bare UUIDs, malformed emails REJECTED with exit 1.
 *   - Falls back to active profile's email when no explicit flag.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';
import {
  requireEmailFlag,
  exitWithEmailFlagError,
} from '../../lib/email-flag.js';

interface CreditsOptions {
  email?: string;
  history?: number;
}

export const creditsCommand: CommandModule<object, CreditsOptions> = {
  command: 'credits',
  describe: 'Check agent credits and transaction history (v0.14 STRICT: --email only).',

  builder: (yargs) =>
    yargs
      .option('email', {
        alias: 'e',
        type: 'string',
        description:
          'Agent email (v0.14 ONLY input). <uuid>@<host> and bare UUIDs REJECTED.',
      })
      .option('history', {
        alias: 'h',
        type: 'number',
        default: 10,
        description: 'Number of recent transactions to show',
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

      const history = ctx.agentService.getCreditHistory(
        agent.id,
        (argv.history as number) ?? 10,
      );

      console.log(chalk.bold('\nAgent Credits:\n'));
      console.log(chalk.cyan('  ID:'), agent.id);
      console.log(chalk.cyan('  Name:'), agent.name);
      console.log(chalk.green(`  Balance: ${agent.credits} credits\n`));

      if (history.length > 0) {
        console.log(chalk.bold('Recent Transactions:\n'));

        history.forEach((tx: any) => {
          const amount = tx.amount >= 0
            ? chalk.green(`+${tx.amount}`)
            : chalk.red(`${tx.amount}`);
          const type = tx.type === 'reward'
            ? chalk.green('[REWARD]')
            : tx.type === 'deduct'
              ? chalk.red('[DEDUCT]')
              : '[TRANSFER]';

          console.log(`  ${type} ${amount} - ${tx.description || 'No description'}`);
          console.log(chalk.gray(`    ${new Date(tx.created_at).toLocaleString()}`));
        });
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
