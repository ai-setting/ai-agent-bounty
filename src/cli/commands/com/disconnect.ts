/**
 * com disconnect command
 *
 * STUB: this command does not maintain an open connection, so
 * "disconnecting" is a no-op beyond printing a placeholder
 * notice. It exists for symmetry with `connect` and so that
 * scripts which chain the two commands do not silently lose
 * messages.
 *
 * Phase feat/v0.13-email-instead-of-uuid:
 * - 新增 --email 选项（v0.13 primary）；--address 仍可用（legacy）
 *
 * Phase fix/v0.13.1-com-read-profile-api-base:
 * - 此命令不做网络请求，但为了与其它 com/* 一致，导入 ProfileContext
 *   使后续如果添加网络/Profile 持久化逻辑时无需再次接线。
 */

import type { CommandModule } from 'yargs';
import { printStubNotice } from './stub.js';
import { ProfileContext } from '../../config/context.js';

interface DisconnectOptions {
  email?: string;
  address?: string;
  all?: boolean;
}

export const disconnectCommand: CommandModule<object, DisconnectOptions> = {
  command: ['disconnect', 'disc'],
  describe: 'Disconnect from Agent IM server (placeholder, no persistent connection)',

  builder: (yargs) =>
    yargs
      .option('email', {
        alias: 'e',
        type: 'string',
        description: 'Agent email (v0.13 primary; preferred over --address)',
      })
      .option('address', {
        alias: 'a',
        type: 'string',
        description:
          'Agent address (format: <uuid>@<host>) [LEGACY: prefer --email in v0.13]',
      })
      .option('all', {
        type: 'boolean',
        description: 'Disconnect all connections',
        default: false,
      }),

  handler: async (args) => {
    const { email, address, all } = args;
    const identifier = (typeof email === 'string' && email.trim())
      ? email.trim()
      : address;

    // v0.13.1: 在 profile 活跃时，把 profile 名字也展示出来便于用户排错
    const profile = ProfileContext.getActive();

    if (!all && !identifier) {
      printStubNotice('disconnect', {});
      console.log('  Use one of:');
      console.log('    bounty com disconnect --email <email>');
      console.log('    bounty com disconnect --address <address>');
      console.log('    bounty com disconnect --all');
      console.log();
      return;
    }

    printStubNotice('disconnect', { identifier, all, profileName: profile?.name });
  },
};
