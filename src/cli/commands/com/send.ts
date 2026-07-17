/**
 * com send command
 * Send message via Agent IM
 *
 * v0.13 changes:
 * - 新增 --from-email / -F 和 --to-email / -T 选项（推荐用 email 替代 address）。
 * - 仍保留 --from / -f 和 --to / -t（address）作为兼容选项；user 不应混用 email 和 address。
 * - 邮箱优先级：--from-email > --from；--to-email > --to。
 *
 * v0.5.0 changes:
 * - 默认开启 TLS 跳过（无需 -k / --insecure flag），通过 fetch-helper.ts 实现
 * - 新增 --tls-verify flag 让用户重新开启 TLS 验证（反向开关）
 * - --insecure / -k 保留为 deprecated 向后兼容（设置 NODE_TLS_REJECT_UNAUTHORIZED=0）
 * - fetch 调用改用 bountyFetch() helper，自动应用 TLS skip
 *
 * Phase feat/com-send-server-url (v0.4.3):
 * - 新增 --server-url / -e 选项：直接指定 IM API base URL（带 scheme，如 https://bounty.example.com:443）。
 *   这对于自签名证书的远程 server 特别有用，避免被 host/port 拼接出错的 scheme。
 * - --server-url 优先级最高：若提供，host/port 被忽略。
 *
 * Roy-Agent 集成：roy-agent 内置 bounty-im handler 现在通过 buildDefaultBountyIMSystemPrompt
 * 把 --server-url 写进 default systemPrompt，从而 agent 在处理 bounty-IM 消息时知道正确的
 * IM API endpoint，无需记忆 host/port 细节。
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { bountyConfig } from '../../../lib/config/bounty-config.js';
import { bountyFetch, setTlsVerifyMode } from '../../lib/fetch-helper.js';
import { readAuthToken } from '../../lib/auth-token.js';
// Backward compat: existing tests (com-send-auth-insecure.test.ts) import readAuthToken from here
export { readAuthToken };

interface SendOptions {
  from?: string;
  to?: string;
  fromEmail?: string;
  toEmail?: string;
  body: string;
  host?: string;
  port?: number;
  serverUrl?: string;
  insecure?: boolean;
  tlsVerify?: boolean;
}

export const sendCommand: CommandModule<object, SendOptions> = {
  command: ['send', 's'],
  describe: 'Send a message via Agent IM (bounty IM)',
  builder: (yargs) =>
    yargs
      .option('from', {
        alias: 'f',
        type: 'string',
        description:
          'Sender address (format: agent-id@host) [LEGACY: prefer --from-email in v0.13]',
      })
      .option('from-email', {
        alias: 'F',
        type: 'string',
        description:
          'Sender email (v0.13 primary; preferred over --from)',
      })
      .option('to', {
        alias: 't',
        type: 'string',
        description:
          'Recipient address (format: agent-id@host) [LEGACY: prefer --to-email in v0.13]',
      })
      .option('to-email', {
        alias: 'T',
        type: 'string',
        description:
          'Recipient email (v0.13 primary; preferred over --to)',
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
          'When set, overrides --host/--port. Recommended for remote or HTTPS endpoints. ' +
          'Auto-attaches Authorization header from ~/.config/bounty/token if present.',
      })
      .option('insecure', {
        alias: 'k',
        type: 'boolean',
        default: undefined,
        description:
          '[Deprecated since v0.5.0] TLS skip is now default. Use --tls-verify to opt back in. ' +
          'Kept for backward compatibility.',
        hidden: true,
      })
      .option('tls-verify', {
        type: 'boolean',
        default: false,
        description:
          'Enable TLS certificate verification (default: skip verification for self-signed certs). ' +
          'When set, NODE_TLS_REJECT_UNAUTHORIZED is unset and Node enforces verification.',
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
      })
      .check((argv) => {
        const fromEmail = argv['from-email'];
        const fromAddr = argv.from;
        const toEmail = argv['to-email'];
        const toAddr = argv.to;
        if (!fromEmail && !fromAddr) {
          throw new Error('Either --from-email/-F or --from/-f is required (v0.13 email-first).');
        }
        if (!toEmail && !toAddr) {
          throw new Error('Either --to-email/-T or --to/-t is required (v0.13 email-first).');
        }
        return true;
      }),
  handler: async (args) => {
    const { from, to, fromEmail, toEmail, body, host, port, serverUrl, tlsVerify } = args;

    // v0.13: email fields win over address fields when both are provided.
    const resolvedFrom = (typeof fromEmail === 'string' && fromEmail.trim()) ? fromEmail.trim() : from;
    const resolvedTo = (typeof toEmail === 'string' && toEmail.trim()) ? toEmail.trim() : to;

    // v0.5.0: TLS mode decision
    // --tls-verify → 开启验证（反向开关）
    // 默认 → 跳过 TLS 验证（setTlsVerifyMode('off') 由 fetch-helper.ts 初始化时已设）
    if (tlsVerify) {
      setTlsVerifyMode('on');
    } else {
      setTlsVerifyMode('off');
    }

    // Authorization header：自动从 ~/.config/bounty/token 加载（如果存在）
    const authToken = readAuthToken();

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
      const authHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (authToken) {
        authHeaders['Authorization'] = `Bearer ${authToken}`;
      }
      // v0.5.0: 用 bountyFetch helper（自动应用 TLS skip 默认值）
      const requestBody: Record<string, unknown> = {
        content: { type: 'text', body },
      };
      // v0.13: pass email fields when caller supplied them so server can
      // resolve via findAgentByEmailOrAddress. Otherwise fall back to
      // legacy from/to (treated as <uuid>@<host> addresses).
      if (resolvedFrom) requestBody.from_email = resolvedFrom;
      if (resolvedTo) requestBody.to_email = resolvedTo;
      // Always include legacy fields as well so old servers continue to work.
      if (resolvedFrom) requestBody.from = resolvedFrom;
      if (resolvedTo) requestBody.to = resolvedTo;

      const response = await bountyFetch(url, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(requestBody),
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