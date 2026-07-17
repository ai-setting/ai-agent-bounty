/**
 * Auth Commands
 * Unified authentication commands for the bounty system
 *
 * Provides a single entry point for all authentication operations:
 * - auth register - Register a new agent
 * - auth verify - Verify email with code
 * - auth login - Login to get auth token
 * - auth logout - Clear stored token
 * - auth refresh - Rotate refresh_token (PR3 new)
 * - auth status - Show current auth status
 * - auth send-code - Resend verification code
 */

import type { CommandModule } from 'yargs';
import { registerCommand } from './register.js';
import { verifyCommand } from './verify.js';
import { loginCommand } from './login.js';
import { logoutCommand } from './logout.js';
import { refreshCommand } from './refresh.js';
import { statusCommand } from './status.js';
import { sendCodeCommand } from './send-code.js';

export const authCommands: CommandModule = {
  command: 'auth',
  describe: 'Authentication commands (register, verify, login, logout, refresh, status)',

  builder: (yargs) =>
    yargs
      .command(registerCommand)
      .command(verifyCommand)
      .command(loginCommand)
      .command(logoutCommand)
      .command(refreshCommand)
      .command(statusCommand)
      .command(sendCodeCommand)
      .demandCommand(1, 'See --help for available commands'),

  handler: () => {
    // This is the parent command handler, should not be reached
    // since we use demandCommand(1)
  },
};

export {
  registerCommand,
  verifyCommand,
  loginCommand,
  logoutCommand,
  refreshCommand,
  statusCommand,
  sendCodeCommand,
};