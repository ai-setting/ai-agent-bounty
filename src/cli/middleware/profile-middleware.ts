import chalk from 'chalk';
import { resolveActiveProfile, type ResolverOptions } from '../config/resolver.js';
import { ProfileContext } from '../config/context.js';
import { updateLastUsed } from '../config/store.js';

export interface MiddlewareOptions extends ResolverOptions {
  stderr?: (...args: unknown[]) => void;
}

/** Resolve the global yargs --profile option and populate ProfileContext. */
export function profileMiddleware(
  argv: Record<string, unknown>,
  opts: MiddlewareOptions = {},
): void {
  const rawProfile = argv.profile ?? argv.P;
  const cliProfile = typeof rawProfile === 'string' ? rawProfile : null;
  const resolved = resolveActiveProfile(cliProfile, opts);

  if (!resolved.exists && (resolved.source === 'cli' || resolved.source === 'env')) {
    const stderr = opts.stderr ?? console.error;
    const available = resolved.available.length > 0
      ? resolved.available.map((name) => `    - ${name}`).join('\n')
      : '    (none — run `bounty profile add <name>` to create one)';
    stderr(chalk.red(
      `\n✗ Profile "${resolved.name}" not found.\n\n` +
      `  Available profiles:\n${available}\n\n` +
      `  To create:\n` +
      `    bounty profile add ${resolved.name} --api-base <url> --token <jwt>\n`,
    ));
    process.exit(2);
  }

  ProfileContext.setActive(resolved.exists ? resolved.profile : null);
  if (resolved.exists) {
    try {
      updateLastUsed(resolved.name, opts);
    } catch {
      // Last-used metadata is best-effort and must not prevent the command.
    }
  }
}
