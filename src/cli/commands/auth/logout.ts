/**
 * Auth logout command.
 *
 * PR3: 优先清空 active profile 的 access_token / refresh_token / expires_at（保留 profile
 * 文件本身，不删除 agent 信息）。如果没有任何 active profile，则回退到清理
 * `~/.config/bounty/token` 旧文件（向后兼容）。
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { rm } from 'fs/promises';
import { ProfileContext } from '../../config/context.js';
import { loadProfile, saveProfile } from '../../config/store.js';
import { DEFAULT_TOKEN_PATH } from '../../lib/auth-token.js';

export const logoutCommand: CommandModule = {
  command: 'logout',
  describe: 'Clear stored authentication token from active profile',

  handler: async () => {
    try {
      const profile = ProfileContext.getActive();
      if (profile) {
        const current = loadProfile(profile.name);
        if (current) {
          current.auth.access_token = undefined;
          current.auth.refresh_token = undefined;
          current.auth.expires_at = undefined;
          current.updated_at = Math.floor(Date.now() / 1000);
          saveProfile(current);
        }
        const displayName = profile.name;
        console.log(chalk.green(`\n✓ Logged out (profile "${displayName}")`));
        console.log('  Cleared access_token / refresh_token from active profile');
        return;
      }

      // No active profile — fall back to removing the legacy token file so
      // pre-PR1 users still get logged out cleanly.
      try {
        await rm(DEFAULT_TOKEN_PATH);
        console.log(chalk.green('\n✓ Logged out'));
        console.log(`  Cleared legacy token at ${DEFAULT_TOKEN_PATH}`);
      } catch {
        console.log(chalk.green('\n✓ Logged out'));
        console.log('  No active profile or legacy token file to clear');
      }
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : 'Logout failed'}\n`));
      process.exit(1);
    }
  },
};

export default logoutCommand;