/**
 * Auth login command.
 *
 * v0.14 STRICT email-only:
 *   - Actor identity input is `--email / -e` ONLY.
 *   - `--agent-address / -a` (`<uuid>@<host>`) is REMOVED.
 *   - Falls back to `ProfileContext.active.email` when no explicit `--email`.
 *   - Otherwise exits 1 with friendly "use --email <your-registered-email>"
 *     or "`bounty profile use <name>`" hint.
 *
 * PR3/PROFILE preserved:
 *   - `ProfileContext.getApiBase()` is preferred over `${API_BASE}`.
 *   - On success, `access_token`/`refresh_token`/`expires_at` are written
 *     back to the active profile (not just `~/.config/bounty/token`).
 *   - `--server-url` overrides profile when explicitly provided.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
import { bountyFetch } from '../../lib/fetch-helper.js';
import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../lib/server-url-option.js';
import { ProfileContext } from '../../config/context.js';
import { loadProfile, saveProfile, type StoreOptions } from '../../config/store.js';
import { resolveProfileApiBase } from '../../lib/profile-api-base.js';
import { writeAuthToProfile } from '../../lib/profile-auth-writer.js';
import {
  requireEmailFlag,
  exitWithEmailFlagError,
} from '../../lib/email-flag.js';

interface LoginOptions {
  email?: string;
  'server-url'?: string;
}

function buildStoreOptions(argv: Record<string, unknown>): StoreOptions {
  const raw = argv.__storeOptions;
  if (raw && typeof raw === 'object') return raw as StoreOptions;
  return {};
}

export const loginCommand: CommandModule<object, LoginOptions> = {
  command: 'login',
  describe: 'Login to get auth token (for already verified accounts). v0.14 STRICT: --email only.',

  builder: (yargs) =>
    addServerUrlOption(
      yargs.option('email', {
        alias: 'e',
        type: 'string',
        description:
          'Agent email (v0.14 ONLY input). <uuid>@<host> and bare UUIDs are REJECTED.',
      })
    ),

  handler: async (argv) => {
    const opts = buildStoreOptions(argv as Record<string, unknown>);

    // v0.14 strict: --email is the ONLY actor identity input.
    const parsed = requireEmailFlag(
      'email',
      argv as Record<string, unknown>,
    );
    if (!parsed.ok) {
      exitWithEmailFlagError(parsed);
    }
    const email = parsed.value;

    try {
      const body: { email: string } = { email };

      console.log(chalk.cyan('\n🔑 Logging in...'));

      const profile = ProfileContext.getActive();
      const baseUrl = resolveProfileApiBase({
        cliServerUrl: argv['server-url'] as string | undefined,
        fallbackApiBase: API_BASE,
        profile,
        resolveServerUrlFn: resolveServerUrl,
      });

      const response = await bountyFetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as {
        token?: string;
        access_token?: string;
        refresh_token?: string | null;
        expires_in?: number;
        agent_id?: string;
        email?: string;
        error?: string;
      };

      if (!response.ok) {
        console.error(chalk.red(`\n✗ Error: ${data.error || 'Login failed'}\n`));
        process.exit(1);
      }

      const accessToken = data.access_token || data.token;
      if (!accessToken) {
        console.error(
          chalk.red(
            '\n✗ Login response missing access_token / token. Server may be incompatible; re-run `bounty auth login --email <email>`.\n',
          ),
        );
        process.exit(1);
      }
      const expiresAt = data.expires_in
        ? Math.floor(Date.now() / 1000) + Number(data.expires_in)
        : undefined;
      const writeResult = writeAuthToProfile({
        profile,
        accessToken,
        refreshToken: data.refresh_token ?? undefined,
        expiresAt,
        agentId: data.agent_id,
        email: data.email ?? email,
        loadProfileFn: (name) => loadProfile(name, opts),
        saveProfileFn: (p) => saveProfile(p, opts),
        consoleOut: console.log,
        logger: (msg: string) => console.log(chalk.cyan(`  ${msg}`)),
      });
      void writeResult;

      const expiresIn = data.expires_in != null ? Math.round(Number(data.expires_in) / 3600) : 24;

      console.log(chalk.green('\n✓ Login successful!'));
      console.log(chalk.cyan('  Agent ID:'), data.agent_id);
      console.log(chalk.cyan('  Email:'), data.email);
      if (profile) {
        console.log(chalk.cyan('  Profile:'), profile.name, chalk.gray(`(${profile.api_base})`));
        console.log(chalk.cyan('  Token:'), chalk.gray('written to profile'));
      }
      console.log(chalk.cyan('  Expires in:'), expiresIn, 'h');
      console.log();
    } catch (error) {
      console.error(
        chalk.red(
          '\n✗ Login failed:',
          error instanceof Error ? error.message : String(error),
        ),
        '\n',
      );
      process.exit(1);
    }
  },
};
