/**
 * com connect command
 *
 * STUB: this command does NOT open a persistent WebSocket or
 * IMAP IDLE session. It just probes the configured IM server
 * to confirm the address is reachable, then prints a
 * placeholder notice. Use the long-running IM HTTP/WebSocket
 * flow via the integrated server for live delivery.
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
  address: string;
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
        .option('address', {
          alias: 'a',
          type: 'string',
          demandOption: true,
          description: 'Your address (format: agent-id@host)',
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
    ),

  handler: async (args) => {
    const { address, host, port } = args;

    // 决定 ws base：--server-url（转 ws scheme） > ws://${host}:${port}
    // 注：connect 是 WS probe，scheme 通常是 ws:// 或 wss://。
    // 我们要求 --server-url 仍传 http/https（与 helper 一致），
    // 然后用 replace(http→ws, https→wss) 转换 scheme 给 WebSocket probe 用。
    // 这保留了 helper 的统一校验语义，同时正确处理 WS endpoint。
    const fallbackBase = `http://${host}:${port}`;
    const httpBase = resolveServerUrl(args['server-url'], fallbackBase);
    const wsBase = httpBase.replace(/^http/, 'ws');

    const wsUrl = `${wsBase}/ws?address=${encodeURIComponent(address)}`;

    console.log(chalk.bold('\n🔗 Probing Agent IM server...\n'));
    console.log(chalk.gray('  Address:'), address);
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

    printStubNotice('connect', { address, host, port });
  },
};

/**
 * Active WebSocket connections (for reference)
 */
export const activeIdleServices: Map<string, WebSocket> = new Map();
