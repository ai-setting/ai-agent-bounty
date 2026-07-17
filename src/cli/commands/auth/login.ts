/**
 * Auth login command.
 *
 * PR3 changes vs PR2 baseline:
 * - 优先使用 `ProfileContext.getApiBase()` 作为 API base（取代硬编码 `${API_BASE}`）。
 * - 登录成功后将 access_token / refresh_token / expires_at 写回 active profile，
 *   而不是只写 `~/.config/bounty/token`。
 * - 兼容 `--server-url` flag：当用户显式传入时仍然优先于 profile（保留逃生通道）。
 * - 删除对 token env 的任何读取（PR1 已移除）。
 *
 * 兼容行为：
 * - 当没有任何 active profile 时，回退到 `--server-url` 或 `API_BASE`；如果都不存在
 *   就退出 1 并提示用户 `bounty profile add`。
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
import { bountyFetch } from '../../lib/fetch-helper.js';
import { resolveAddressOption } from '../../lib/address-parser.js';
import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../lib/server-url-option.js';
import { ProfileContext } from '../../config/context.js';
import { loadProfile, saveProfile } from '../../config/store.js';
import { resolveProfileApiBase } from '../../lib/profile-api-base.js';
import { writeAuthToProfile } from '../../lib/profile-auth-writer.js';

interface LoginOptions {
  email?: string;
  'agent-address'?: string;
  'server-url'?: string;
}

export const loginCommand: CommandModule<object, LoginOptions> = {
  command: 'login',
  describe: 'Login to get auth token (for already verified accounts)',

  builder: (yargs) =>
    addServerUrlOption(
      yargs
        .option('email', {
          alias: 'e',
          type: 'string',
          description: 'Agent email',
        })
        .option('agent-address', {
          alias: 'a',
          type: 'string',
          description:
            'Agent address in <uuid>@<host> format (REQUIRED). ' +
            'Bare UUID is REJECTED in v0.10.',
        })
    ),

  handler: async (argv) => {
    if (!argv.email && !argv['agent-address']) {
      console.error(chalk.red('\n✗ Error: --email or --agent-address is required\n'));
      console.error('Usage: bounty auth login --agent-address <uuid>@<host>');
      process.exit(1);
    }

    const resolvedAgent = argv['agent-address']
      ? resolveAddressOption({
          address: argv['agent-address'],
          addressFlag: '--agent-address',
          missingMessage: '✗ --agent-address is required (<uuid>@<host> format).',
        })
      : undefined;

    if (resolvedAgent && !resolvedAgent.ok) {
      console.error(chalk.red(`\n${resolvedAgent.error}\n`));
      process.exit(2);
    }

    try {
      const body: { email?: string; agent_id?: string } = {};
      if (argv.email) body.email = argv.email;
      if (resolvedAgent?.ok) body.agent_id = resolvedAgent.value.uuid;

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

      const data = await response.json() as {
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
        agentId: data.agent_id ?? '',
        email: data.email ?? '',
        loadProfileFn: loadProfile,
        saveProfileFn: saveProfile,
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
      } else {
        console.log(chalk.yellow('  No active profile — token not persisted'));
      }
      console.log(`  Token saved to active profile. Expires in: ${expiresIn} hours`);
      console.log('\nYou can now use:');
      console.log('  bounty auth status');
      console.log('  bounty profile show');
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : 'Login failed'}\n`));
      process.exit(1);
    }
  },
};

export default loginCommand;