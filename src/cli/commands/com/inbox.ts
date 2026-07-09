/**
 * com inbox command
 * Check inbox messages via Agent IM
 *
 * Phase feat/bounty-all-commands-server-url:
 * - 新增 --server-url / -u 选项：通过 addServerUrlOption helper 复用
 * - --server-url 提供时覆盖 --host/--port，回退保持向后兼容
 * - 校验 + trim 由 resolveServerUrl helper 处理
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { bountyConfig } from '../../../lib/config/bounty-config.js';
import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../../lib/server-url-option.js';

interface InboxOptions {
  address: string;
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
        .option('address', {
          alias: 'a',
          type: 'string',
          demandOption: true,
          description: 'Agent address (format: agent-id@host)',
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
    ),

  handler: async (args) => {
    const { address, host, port, limit } = args;

    // baseUrl: --server-url > 默认 (http://localhost:port)
    // 注意：inbox 的 fallback base 是动态拼出来的（包含 port），不是 API_BASE 那种静态值
    const fallbackBase = `http://${host}:${port}`;
    const baseUrl = resolveServerUrl(args['server-url'], fallbackBase);
    const url = `${baseUrl}/messages?address=${encodeURIComponent(address)}`;
    
    try {
      const response = await fetch(url);
      
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
