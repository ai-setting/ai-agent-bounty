/**
 * com send command
 * Send message via Agent IM
 *
 * Phase feat/com-send-server-url:
 * - 新增 --server-url / -e 选项：直接指定 IM API base URL（带 scheme，如 https://bounty.example.com:443）。
 *   这对于自签名证书的远程 server 特别有用，避免被 host/port 拼接出错的 scheme。
 * - --server-url 优先级最高：若提供，host/port 被忽略。
 * - 同步更新 help 输出。
 *
 * Roy-Agent 集成：roy-agent 内置 bounty-im handler 现在通过 buildDefaultBountyIMSystemPrompt
 * 把 --server-url 写进 default systemPrompt，从而 agent 在处理 bounty-IM 消息时知道正确的
 * IM API endpoint，无需记忆 host/port 细节。
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { bountyConfig } from '../../../lib/config/bounty-config.js';

interface SendOptions {
  from: string;
  to: string;
  body: string;
  host?: string;
  port?: number;
  serverUrl?: string;
}

export const sendCommand: CommandModule<object, SendOptions> = {
  command: ['send', 's'],
  describe: 'Send a message via Agent IM (bounty IM)',
  builder: (yargs) =>
    yargs
      .option('from', {
        alias: 'f',
        type: 'string',
        demandOption: true,
        description: 'Sender address (format: agent-id@host)',
      })
      .option('to', {
        alias: 't',
        type: 'string',
        demandOption: true,
        description: 'Recipient address (format: agent-id@host)',
      })
      .option('body', {
        alias: 'b',
        type: 'string',
        demandOption: true,
        description: 'Message body',
      })
      .option('server-url', {
        alias: 'e',
        type: 'string',
        description:
          'IM server base URL with scheme (e.g. https://bounty.tongagents.example.com:443). ' +
          'When set, overrides --host/--port. Recommended for remote or HTTPS endpoints.',
      })
      .option('host', {
        alias: 'H',
        type: 'string',
        description: 'IM server host (default uses BOUNTY_HOST env or localhost). Ignored when --server-url is set.',
        default: bountyConfig.host,
      })
      .option('port', {
        alias: 'p',
        type: 'number',
        description: 'IM server port (default uses BOUNTY_PORT env or 4000). Ignored when --server-url is set.',
        default: bountyConfig.port,
      }),
  handler: async (args) => {
    const { from, to, body, host, port, serverUrl } = args;

    // 优先级：--server-url > --host/--port
    // --server-url 必须带 scheme（http:// 或 https://），且不含尾斜杠
    let url: string;
    if (serverUrl) {
      const trimmed = serverUrl.replace(/\/+$/, '');
      // 安全检查：必须以 http:// 或 https:// 开头
      if (!/^https?:\/\//.test(trimmed)) {
        console.error(
          chalk.red(`\n✗ Invalid --server-url: "${serverUrl}". Must start with http:// or https://\n`)
        );
        process.exit(1);
      }
      url = `${trimmed}/api/messages`;
    } else {
      // 回退：--host/--port 拼接（默认 http://）
      url = `http://${host}:${port}/messages`;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to,
          content: { type: 'text', body },
        }),
      });

      if (response.ok) {
        const message = (await response.json()) as any;
        console.log(chalk.green('\n✓ Message sent successfully\n'));
        console.log(chalk.cyan('  ID:'), message.id);
        console.log(chalk.cyan('  From:'), message.from);
        console.log(chalk.cyan('  To:'), message.to);
        console.log();
      } else {
        const error = await response.text();
        console.error(chalk.red(`\n✗ Failed to send message (${response.status})`));
        console.error(error);
        process.exit(1);
      }
    } catch (error) {
      console.error(
        chalk.red('\n✗ Error sending message:'),
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  },
};