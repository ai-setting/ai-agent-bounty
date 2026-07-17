/**
 * agent credits command
 * Check agent credits and transaction history
 *
 * v0.10: --id / -i REMOVED. Use --agent-address <uuid>@<host>.
 *
 * v0.13: --email is now the PRIMARY lookup key; --agent-address remains as
 *   a backward-compatible secondary option. At least one is required.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';
import { resolveAddressOption } from '../../lib/address-parser.js';

interface CreditsOptions {
  'agent-address'?: string;
  email?: string;
  history?: number;
}

export const creditsCommand: CommandModule<object, CreditsOptions> = {
  command: 'credits',
  describe: 'Check agent credits and transaction history',

  builder: (yargs) =>
    yargs
      .option('email', {
        alias: 'e',
        type: 'string',
        description: 'Agent email (v0.13 primary; preferred over --agent-address)',
      })
      .option('agent-address', {
        alias: 'a',
        type: 'string',
        description:
          'Agent address in <uuid>@<host> format (REQUIRED). ' +
          'Bare UUID is REJECTED in v0.10. [LEGACY: prefer --email in v0.13]',
      })
      .option('history', {
        alias: 'h',
        type: 'number',
        default: 10,
        description: 'Number of recent transactions to show',
      })
      .check((argv) => {
        if (!argv.email && !argv['agent-address']) {
          throw new Error('Either --email or --agent-address is required (v0.13 email-first).');
        }
        return true;
      }),

  handler: async (argv) => {
    const options = argv as unknown as CreditsOptions;
    const ctx = createContext();

    try {
      // v0.13: email-first lookup; falls back to address parser.
      let agent: ReturnType<typeof ctx.agentService.findByAddress> | null = null;

      if (options.email) {
        agent = ctx.agentService.getByEmail(options.email);
      } else if (options['agent-address']) {
        const resolvedAgent = resolveAddressOption({
          address: options['agent-address'],
          addressFlag: '--agent-address',
          missingMessage: '✗ --agent-address is required (<uuid>@<host> format)',
        });

        if (!resolvedAgent.ok) {
          console.error(chalk.red(`\n${resolvedAgent.error}\n`));
          ctx.db.close();
          process.exit(2);
        }
        agent = ctx.agentService.findByAddress(resolvedAgent.value.raw);
      }

      if (!agent) {
        console.error(chalk.red('\n✗ Error: Agent not found\n'));
        ctx.db.close();
        process.exit(1);
      }

      const history = ctx.agentService.getCreditHistory(
        agent.id,
        options.history as number
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
