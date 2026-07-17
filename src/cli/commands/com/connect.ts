/**
 * com connect command
 *
 * STUB: this command does NOT open a persistent WebSocket or
 * IMAP IDLE session. It just probes the configured IM server
 * to confirm the address is reachable, then prints a
 * placeholder notice. Use the long-running IM HTTP/WebSocket
 * flow via the integrated server for live delivery.
 *
 * Phase feat/v0.13-email-instead-of-uuid:
 * - 新增 --email 选项（v0.13 primary）；--address 仍可用（legacy）
 * - 当同时提供时，--email 优先；客户端会让 server 解析 email → address
 *
 * Phase feat/bounty-all-commands-server-url:
 * - 新增 --server-url / -u 选项：通过 addServerUrlOption helper 复用
 * - --server-url 提供时覆盖 --host/--port，回退保持向后兼容
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { bountyConfig } from '../../../lib/config/bounty-config.js';
import { printStubNotice } from './stub.js';
import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../lib/server-url-option.js';

interface ConnectOptions {
  email?: string;
  address?: string;
  host?: string;
  port?: number;
  'server-url'?: string;
}

export const connectCommand: CommandModule<object, ConnectOptions> = {
  command: ['connect', 'conn'],
  describe: 'Probe the Agent IM server (placeholder, no persistent connection)',

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
        .check((argv) => {
          if (!argv.email && !argv.address) {
            throw new Error('Either --email or --address is required (v0.13 email-first).');
          }
          return true;
        })
    ),

  handler: async (args) => {
    const { email, address, host, port } = args;
    const identifier = (typeof email === 'string' && email.trim())
      ? email.trim()
      : (address ?? '');

    // 决定 ws base：--server-url（转 ws scheme） > ws://${host}:${port}
    // 注：connect 是 WS probe，scheme 通常是 ws:// 或 wss://。
    // 我们要求 --server-url 仍传 http/https（与 helper 一致），
    // 然后用 replace(http→ws, https→wss) 转换 scheme 给 WebSocket probe 用。
    // 这保留了 helper 的统一校验语义，同时正确处理 WS endpoint。
    const fallbackBase = `http://${host}:${port}`;
    const httpBase = resolveServerUrl(args['server-url'], fallbackBase);
    const wsBase = httpBase.replace(/^http/, 'ws');

    // v0.13: prefer `?email=`; legacy `?address=` remains supported by server.
    const wsUrl = `${wsBase}/ws?email=${encodeURIComponent(identifier)}`;

    console.log(chalk.bold('\n🔗 Probing Agent IM server...\n'));
    console.log(chalk.gray('  Identifier:'), identifier);
    console.log(chalk.gray('  Server:'), `${wsBase}/ws`);
    console.log(chalk.gray('  Port:'), port, chalk.gray('(from BOUNTY_PORT)'));
    console.log();

    try {
      const ws = new WebSocket(wsUrl);

      const connected = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve(false);
        }, 5000);

        ws.onopen = () => {
          clearTimeout(timeout);
          ws.close();
          resolve(true);
        };

        ws.onerror = () => {
          clearTimeout(timeout);
        };
      });

      if (connected) {
        console.log(chalk.green('✓ Server is reachable\n'));
      } else {
        console.log(chalk.yellow('⚠ Server did not respond within 5s\n'));
        console.log(chalk.gray('  The server may be unreachable or the address format may be invalid.\n'));
      }
    } catch (error) {
      console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }

    printStubNotice('connect', { identifier, host, port });
  },
};

/**
 * Active WebSocket connections (for reference)
 */
export const activeIdleServices: Map<string, WebSocket> = new Map();
