/**
 * com send command — v0.14 strict email-only contract.
 *
 * v0.13: --from-email / -F and --to-email / -T added (email-first);
 *        --from / -f and --to / -t retained as legacy compat.
 * v0.14 BREAKING:
 *   - --from / -f and --to / -t REMOVED (legacy address form).
 *   - --from-email / -F is the ONLY sender input.
 *   - --to-email / -T is the ONLY recipient input.
 *   - HTTP body uses {from_email, to_email} ONLY (no `from` / `to` keys).
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { bountyConfig } from '../../../lib/config/bounty-config.js';
import { bountyFetch, setTlsVerifyMode } from '../../lib/fetch-helper.js';
import { readAuthToken } from '../../lib/auth-token.js';
import { ProfileContext } from '../../config/context.js';
import {
  requireEmailFlag,
  exitWithEmailFlagError,
} from '../../lib/email-flag.js';
// Backward compat: existing tests (com-send-auth-insecure.test.ts) import readAuthToken from here
export { readAuthToken };

interface SendOptions {
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
      .option('from-email', {
        alias: 'F',
        type: 'string',
        description:
          'Sender email (v0.14 ONLY input). <uuid>@<host> and bare UUIDs REJECTED.',
      })
      .option('to-email', {
        alias: 'T',
        type: 'string',
        description:
          'Recipient email (v0.14 ONLY input). <uuid>@<host> and bare UUIDs REJECTED.',
      })
      .option('body', {
        alias: 'b',
        type: 'string',
        demandOption: true,
        description: 'Message body',
      })
      .option('server-url', {
        alias: 'u',
        type: 'string',
        description:
          'IM server base URL with scheme (e.g. https://bounty.tongagents.example.com:443). ' +
          'When set, overrides --host/--port. Recommended for remote or HTTPS endpoints. ' +
          'Auto-attaches Authorization header from ~/.config/bounty/token if present. ' +
          'v0.14 alias renamed from `-e` to `-u` to free `-e` for --from-email / --to-email.',
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
      }),
  handler: async (args) => {
    const { body, host, port, serverUrl, tlsVerify } = args;

    // v0.14 strict: --from-email / --to-email are the ONLY actor inputs.
    // requireEmailFlag handles precedence (explicit > ProfileContext.active.email)
    // and rejects legacy <uuid>@<host> / bare UUIDs / malformed input.
    const fromParsed = requireEmailFlag(
      'from-email',
      args as Record<string, unknown>,
    );
    if (!fromParsed.ok) {
      exitWithEmailFlagError(fromParsed);
    }
    const toParsed = requireEmailFlag(
      'to-email',
      args as Record<string, unknown>,
    );
    if (!toParsed.ok) {
      exitWithEmailFlagError(toParsed);
    }

    // v0.5.0: TLS mode decision
    if (tlsVerify) {
      setTlsVerifyMode('on');
    } else {
      setTlsVerifyMode('off');
    }

    const authToken = readAuthToken();

    // 优先级：--server-url > profile.api_base > --host/--port
    let url: string;
    if (serverUrl) {
      const trimmed = serverUrl.replace(/\/+$/, '');
      if (!/^https?:\/\//.test(trimmed)) {
        console.error(
          chalk.red(`\n✗ Invalid --server-url: "${serverUrl}". Must start with http:// or https://\n`)
        );
        process.exit(1);
      }
      url = `${trimmed}/api/messages`;
    } else {
      const profileApiBase = ProfileContext.getApiBase();
      if (profileApiBase) {
        const trimmed = profileApiBase.replace(/\/+$/, '');
        url = `${trimmed}/api/messages`;
      } else {
        url = `http://${host}:${port}/messages`;
      }
    }

    try {
      const authHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (authToken) {
        authHeaders['Authorization'] = `Bearer ${authToken}`;
      }
      const requestBody: Record<string, unknown> = {
        content: { type: 'text', body },
        from_email: fromParsed.value,
        to_email: toParsed.value,
      };

      const response = await bountyFetch(url, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        const message = (await response.json()) as any;
        console.log(chalk.green('\n✓ Message sent successfully\n'));
        console.log(chalk.cyan('  ID:'), message.id);
        // v0.14.1: prefer the registered email (`from_email` / `to_email`)
        // for human-readable display; fall back to canonical `from` / `to`
        // when the server response predates v0.14.1 (no enrichment).
        const fromDisplay = (typeof message.from_email === 'string' && message.from_email) || message.from;
        const toDisplay = (typeof message.to_email === 'string' && message.to_email) || message.to;
        console.log(chalk.cyan('  From:'), fromDisplay);
        console.log(chalk.cyan('  To:'), toDisplay);
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
