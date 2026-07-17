/**
 * com addresses command
 *
 * STUB: addresses in the Agent IM model are just strings of the
 * form `agent-id@host`. There is no global registry to list, so
 * this command prints the address-format documentation and the
 * agent's default address (when --agent-id is supplied). The
 * placeholder notice makes it clear that nothing has been queried
 * server-side.
 *
 * Phase feat/v0.13-email-instead-of-uuid:
 * - 新增 --email 选项：仅作为 help-time hint，placeholder 仍然按 agent-id 拼出默认 address。
 *   Server 端的 agents.email UNIQUE column 是 v0.13 的 primary lookup key（参考
 *   src/server/lib/address-resolver.ts）。
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { printStubNotice } from './stub.js';

interface AddressesOptions {
  agentId?: string;
  email?: string;
}

export const addressesCommand: CommandModule<object, AddressesOptions> = {
  command: ['addresses', 'addr'],
  describe: 'Show address format and the local agent default (placeholder)',

  builder: (yargs) =>
    yargs
      .option('agent-id', {
        alias: 'a',
        type: 'string',
        description: 'Agent ID (optional, uses default if not specified)',
      })
      .option('email', {
        alias: 'e',
        type: 'string',
        description: 'Agent email (v0.13 hint; informational only in this stub)',
      }),

  handler: async (args) => {
    const { agentId, email } = args;

    console.log(chalk.bold('\nAgent IM Addresses\n'));
    console.log(chalk.gray('  Format: agent-id@host\n'));
    console.log(chalk.cyan('  Example addresses:'));
    console.log(chalk.gray('    alice@server.com'));
    console.log(chalk.gray('    bob@production.local'));
    console.log(chalk.gray('    worker-001@localhost'));
    console.log();

    if (agentId) {
      console.log(chalk.cyan('  Agent ID:'), agentId);
      console.log(chalk.cyan('  Default Address:'), `${agentId}@localhost`);
      console.log();
    }
    if (email) {
      console.log(chalk.cyan('  Email (v0.13 primary lookup):'), email);
      console.log();
    }

    printStubNotice('addresses', { agentId, email });
  },
};
