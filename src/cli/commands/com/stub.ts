/**
 * Shared helpers for the com CLI stub commands (H5)
 *
 * The `connect`, `disconnect`, `config`, and `addresses` commands
 * do not currently open a long-lived IMAP/WebSocket connection or
 * persist a config file — they just print information to the user.
 *
 * To prevent operators from being misled into chaining these
 * commands behind scripts, every stub now prints an explicit
 * "placeholder" notice that lists the arguments the user supplied.
 * The shared helpers in this module make that contract testable
 * and consistent across all four commands.
 */

import chalk from 'chalk';

export const STUB_NOTICE = 'placeholder: this command is a placeholder';
export const STUB_FOOTER =
  'No persistent connection is opened by this command. ' +
  'Use a real client (e.g. the integrated `bounty com send` HTTP API) for live delivery.';

/**
 * Print a uniform "this is a placeholder" notice for a com stub.
 *
 * @param verb - the command name, e.g. 'connect' / 'disconnect'
 * @param args - the parsed yargs arguments to reflect back to the user
 */
export function printStubNotice(verb: string, args: Record<string, unknown> = {}): void {
  console.log(chalk.yellow(`\n⚠ ${STUB_NOTICE}`));
  console.log(chalk.cyan(`  Command: bounty com ${verb}`));

  const keys = Object.keys(args);
  if (keys.length > 0) {
    console.log(chalk.cyan('  Arguments:'));
    for (const key of keys) {
      const value = args[key];
      if (value === undefined || value === null || value === false) continue;
      console.log(chalk.gray(`    --${key}: ${String(value)}`));
    }
  }

  console.log(chalk.gray(`\n  ${STUB_FOOTER}\n`));
}
