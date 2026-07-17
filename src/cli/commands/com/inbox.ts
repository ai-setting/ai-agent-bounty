/**
 * com inbox command
 * Check inbox messages via Agent IM
 *
 * Phase feat/v0.13-email-instead-of-uuid:
 * - 新增 --email 选项（v0.13 primary；优先于 --address）
 * - --address 仍可用（legacy 兼容）
 * - 当同时提供时，--email 优先；否则回退到 --address
 *
 * Phase feat/bounty-all-commands-server-url:
 * - 新增 --server-url / -u 选项：通过 addServerUrlOption helper 复用
 * - --server-url 提供时覆盖 --host/--port，回退保持向后兼容
 * - 校验 + trim 由 resolveServerUrl helper 处理
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { bountyConfig } from '../../../lib/config/bounty-config.js';
// v0.5.0: TLS skip default — use bountyFetch wrapper
import { bountyFetch } from '../../lib/fetch-helper.js';

import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../lib/server-url-option.js';

interface InboxOptions {
  address?: string;
  email?: string;
  host?: string;
  port?: number;
  limit?: number;
  'server-url'?: string;
}

export const inboxCommand: CommandModule<object, InboxOptions> = {
  command: ['inbox', 'i'],
  describe: 'Check inbox messages via Agent IM',

  builder: (yargs) =>
    addServerUrlOption(
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
        .option('host', {
          alias: 'H',
          type: 'string',
          description: 'IM server host (default: localhost). Ignored when --server-url is set.',
          default: 'localhost',
        })
        .option('port', {
          alias: 'p',
          type: 'number',
          description: 'IM server port. Ignored when --server-url is set.',
          default: bountyConfig.port,
        })
        .option('limit', {
          alias: 'l',
          type: 'number',
          description: 'Number of messages to show',
          default: 10,
        })
        .check((argv) => {
          if (!argv.email && !argv.address) {
            throw new Error('Either --email or --address is required (v0.13 email-first).');
          }
          return true;
        })
    ),

  handler: async (args) => {
    const { email, address, host, port, limit } = args;
    // v0.13: email takes priority over address when both are supplied.
    const identifier = (typeof email === 'string' && email.trim())
      ? email.trim()
      : (address ?? '');

    // baseUrl: --server-url > 默认 (http://localhost:port)
    // 注意：inbox 的 fallback base 是动态拼出来的（包含 port），不是 API_BASE 那种静态值
    const fallbackBase = `http://${host}:${port}`;
    const baseUrl = resolveServerUrl(args['server-url'], fallbackBase);
    // v0.13: prefer `?email=`; legacy callers may still send `?address=`.
    // The server resolves either form via findAgentByEmailOrAddress.
    const url = `${baseUrl}/messages?email=${encodeURIComponent(identifier)}`;

    try {
      const response = await bountyFetch(url);
      
      if (response.ok) {
        const messages = await response.json() as any[];
        
        if (messages.length === 0) {
          console.log(chalk.yellow('\nNo messages in inbox.\n'));
        } else {
          const displayMessages = messages.slice(0, limit || 10);
          console.log(chalk.bold(`\nInbox (${messages.length} messages, showing ${displayMessages.length}):\n`));
          
          displayMessages.forEach((msg: any) => {
            const statusIcon = msg.status === 'acked' ? '✓' : msg.status === 'delivered' ? '●' : '○';
            console.log(chalk.cyan(`[${statusIcon}] From: ${msg.from}`));
            console.log(chalk.cyan(`    To: ${msg.to}`));
            if (msg.content?.type === 'text') {
              const preview = msg.content.body.substring(0, 100).replace(/\n/g, ' ');
              console.log(chalk.gray(`    ${preview}...`));
            }
            console.log(chalk.gray(`    Status: ${msg.status} | ${new Date(msg.createdAt).toLocaleString()}`));
            console.log();
          });
        }
      } else {
        console.error(chalk.red(`\n✗ Failed to get inbox (${response.status})\n`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('\n✗ Error getting inbox:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
};
