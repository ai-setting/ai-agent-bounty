/**
 * Auth refresh command.
 *
 * PR3 new: 用 active profile 的 refresh_token 调用 POST /api/auth/refresh 换取
 * 新的 access_token + refresh_token，然后写回 active profile。
 *
 * - 若没有 active profile / 没有 refresh_token → 友好提示用户重新 `auth login`。
 * - API base 解析复用 resolveProfileApiBase（profile → --server-url → API_BASE）。
 * - 失败时透传 server error，不静默吞错。
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
import { loadProfile, saveProfile } from '../../config/store.js';
import { resolveProfileApiBase } from '../../lib/profile-api-base.js';
import { writeAuthToProfile } from '../../lib/profile-auth-writer.js';

interface RefreshOptions {
  'server-url'?: string;
}

export const refreshCommand: CommandModule<object, RefreshOptions> = {
  command: 'refresh',
  describe: 'Refresh access token using profile refresh_token',

  builder: (yargs) => addServerUrlOption(yargs),

  handler: async (argv) => {
    try {
      const profile = ProfileContext.getActive();
      if (!profile) {
        console.error(
          chalk.red(
            '\n✗ No active profile. Run `bounty profile use <name>` (or pass --profile) and try again.\n',
          ),
        );
        process.exit(1);
      }
      const loaded = loadProfile(profile.name);
      const refreshToken = loaded?.auth.refresh_token;
      if (!refreshToken) {
        console.error(
          chalk.red(
            `\n✗ Profile "${profile.name}" has no refresh_token. Run \`bounty auth login\` again.\n`,
          ),
        );
        process.exit(1);
      }

      console.log(chalk.cyan(`\n♻️  Refreshing token for profile "${profile.name}"...`));

      const baseUrl = resolveProfileApiBase({
        cliServerUrl: argv['server-url'] as string | undefined,
        fallbackApiBase: API_BASE,
        profile: loaded ?? profile,
        resolveServerUrlFn: resolveServerUrl,
      });

      const response = await bountyFetch(`${baseUrl}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      const data = await response.json() as {
        access_token?: string;
        refresh_token?: string | null;
        expires_in?: number;
        agent_id?: string;
        email?: string;
        error?: string;
      };

      if (!response.ok) {
        console.error(
          chalk.red(`\n✗ Refresh failed: ${data.error || response.statusText}\n`),
        );
        process.exit(1);
      }

      const accessToken = data.access_token;
      if (!accessToken) {
        console.error(
          chalk.red(
            '\n✗ Refresh response missing access_token. Server may not support refresh; re-run `bounty auth login`.\n',
          ),
        );
        process.exit(1);
      }

      const expiresAt = data.expires_in
        ? Math.floor(Date.now() / 1000) + Number(data.expires_in)
        : undefined;
      writeAuthToProfile({
        profile: loaded ?? profile,
        accessToken,
        refreshToken: data.refresh_token ?? refreshToken,
        expiresAt,
        agentId: data.agent_id,
        email: data.email,
        loadProfileFn: loadProfile,
        saveProfileFn: saveProfile,
        consoleOut: console.log,
        logger: (msg: string) => console.log(chalk.cyan(`  ${msg}`)),
      });

      console.log(chalk.green('\n✓ Token refreshed'));
      if (data.expires_in) {
        console.log(`  Expires in: ${Math.round(Number(data.expires_in) / 3600)} hours`);
      }
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : 'Refresh failed'}\n`));
      process.exit(1);
    }
  },
};

export default refreshCommand;