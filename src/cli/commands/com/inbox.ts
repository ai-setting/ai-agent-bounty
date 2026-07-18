/**
 * com inbox command
 * Check inbox messages via Agent IM.
 *
 * v0.14 STRICT email-only:
 *   - `--email / -e` is the ONLY actor identity flag.
 *   - `--address / -a` is REMOVED.
 *   - Falls back to active profile's email when no explicit flag.
 *   - <uuid>@<host>, bare UUIDs, malformed emails REJECTED with exit 1.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { bountyConfig } from '../../../lib/config/bounty-config.js';
import { bountyFetch } from '../../lib/fetch-helper.js';
import { readAuthToken } from '../../lib/auth-token.js';
import { ProfileContext } from '../../config/context.js';
import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../lib/server-url-option.js';
import {
  requireEmailFlag,
  exitWithEmailFlagError,
} from '../../lib/email-flag.js';

interface InboxOptions {
  email?: string;
  host?: string;
  port?: number;
  limit?: number;
  'server-url'?: string;
}

export const inboxCommand: CommandModule<object, InboxOptions> = {
  command: ['inbox', 'i'],
  describe: 'Check inbox messages via Agent IM (v0.14 STRICT: --email only).',

  builder: (yargs) =>
    addServerUrlOption(
      yargs
        .option('email', {
          alias: 'e',
          type: 'string',
          description:
            'Agent email (v0.14 ONLY input). <uuid>@<host> and bare UUIDs REJECTED.',
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
    // v0.14 strict: --email is the ONLY actor identity input.
    const parsed = requireEmailFlag(
      'email',
      args as Record<string, unknown>,
    );
    if (!parsed.ok) {
      exitWithEmailFlagError(parsed);
    }
    const email = parsed.value;

    const { host, port, limit } = args;

    // baseUrl: --server-url > active profile.api_base > 默认 (http://host:port)
    const profileApiBase = ProfileContext.getApiBase();
    const fallbackBase = `http://${host}:${port}`;
    let baseUrl: string;
    if (!args['server-url'] && profileApiBase) {
      baseUrl = profileApiBase.replace(/\/+$/, '');
    } else {
      baseUrl = resolveServerUrl(args['server-url'], fallbackBase);
    }
    // v0.14: --email only. Send ?email=<registered-email>.
    const url = `${baseUrl}/api/messages?email=${encodeURIComponent(email)}`;

    try {
      // v0.13.2: attach Bearer JWT so the server's token check (default ON
      // since v0.13) accepts the request.
      const authToken = readAuthToken();
      const authHeaders: Record<string, string> = {};
      if (authToken) {
        authHeaders['Authorization'] = `Bearer ${authToken}`;
      }
      const response = await bountyFetch(url, { headers: authHeaders });

      if (response.ok) {
        const messages = (await response.json()) as any[];

        if (messages.length === 0) {
          console.log(chalk.yellow('\nNo messages in inbox.\n'));
        } else {
          const displayMessages = messages.slice(0, limit || 10);
          console.log(chalk.bold(`\nInbox (${messages.length} messages, showing ${displayMessages.length}):\n`));

          displayMessages.forEach((msg: any) => {
            const statusIcon = msg.status === 'acked' ? '✓' : msg.status === 'delivered' ? '●' : '○';
            // v0.14.1: prefer the registered email (`from_email` / `to_email`)
            // for human-readable display; fall back to canonical `from` / `to`
            // when the server response predates v0.14.1 (no enrichment).
            const fromDisplay = (typeof msg.from_email === 'string' && msg.from_email) || msg.from;
            const toDisplay = (typeof msg.to_email === 'string' && msg.to_email) || msg.to;
            console.log(chalk.cyan(`[${statusIcon}] From: ${fromDisplay}`));
            console.log(chalk.cyan(`    To: ${toDisplay}`));
            if (msg.content?.type === 'text') {
              const preview = msg.content.body.substring(0, 100).replace(/\n/g, ' ');
              console.log(chalk.gray(`    ${preview}...`));
            }
            console.log(chalk.gray(`    [${msg.status}] ${new Date(msg.created_at).toISOString()}`));
            console.log();
          });
        }
      } else if (response.status === 401) {
        console.error(chalk.red('\n✗ Unauthorized. Run `bounty auth login --email <your-registered-email>` first.\n'));
        process.exit(1);
      } else {
        const error = await response.text();
        console.error(chalk.red(`\n✗ Failed to fetch inbox (${response.status})`));
        console.error(error);
        process.exit(1);
      }
    } catch (error) {
      console.error(
        chalk.red(
          '\n✗ Error fetching inbox:',
          error instanceof Error ? error.message : String(error),
        ),
      );
      process.exit(1);
    }
  },
};
