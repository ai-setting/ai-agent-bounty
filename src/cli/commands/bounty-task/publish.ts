/**
 * bounty publish command
 *
 * v0.7: address-based publisher identity + tolerant optional fields.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { bountyConfig } from '../../../lib/config/bounty-config.js';
import { addServerUrlOption, resolveServerUrl } from '../../lib/server-url-option.js';
import { bountyHttp, BountyHttpError } from '../../lib/bounty-http.js';
import { resolveCurrentAgent } from '../../lib/current-agent.js';
import { generateIdempotencyKey } from '../../lib/idempotency-key.js';
import { shouldJson, jsonOutput, isQuiet, quietIdOutput } from '../../lib/json-output.js';
import { resolveAgentIdOption } from '../../lib/address-parser.js';
import { validatePublishInput } from '../../lib/input-validator.js';

interface PublishOptions {
  title: string;
  description?: string;
  'description-file'?: string;
  type: string;
  reward: number | string;
  'publisher-address'?: string;
  /** @deprecated Use --publisher-address. */
  'publisher-id'?: string;
  tags?: string;
  deadline?: number | string;
  'server-url'?: string;
  'idempotency-key'?: string;
  json?: boolean;
  quiet?: boolean;
}

interface BountyTask {
  id: string;
  title: string;
  description?: string;
  type: string;
  reward: number;
  status: string;
  publisherId: string;
  publisherAddress?: string;
  tags?: string[];
}

export const publishCommand: CommandModule<object, PublishOptions> = {
  command: 'publish',
  describe: 'Publish a new bounty task (via HTTP API)',

  builder: (yargs) =>
    addServerUrlOption(
      yargs
        .option('title', {
          alias: 't',
          type: 'string',
          demandOption: true,
          description: 'Task title',
        })
        .option('description', {
          alias: 'd',
          type: 'string',
          description: 'Task description (optional).',
        })
        .option('description-file', {
          alias: 'f',
          type: 'string',
          description:
            'Path to a file whose content will be used as the task ' +
            'description. Useful for large descriptions (>50KB). Optional.',
        })
        .option('type', {
          alias: 'y',
          type: 'string',
          demandOption: true,
          description: 'Task type (e.g., coding, writing, research)',
        })
        .option('reward', {
          alias: 'r',
          type: 'number',
          demandOption: true,
          description: 'Reward credits (must be > 0)',
        })
        .option('publisher-address', {
          alias: 'p',
          type: 'string',
          description:
            'Publisher agent address (<uuid>@<host>). Pure <uuid> is also accepted. ' +
            'Defaults to BOUNTY_IM_ADDRESS env.',
        })
        .option('publisher-id', {
          type: 'string',
          description: '[deprecated] Publisher agent ID. Use --publisher-address instead.',
        })
        .option('tags', {
          alias: 'g',
          type: 'string',
          description: 'Comma-separated tags (optional)',
        })
        .option('deadline', {
          alias: 'l',
          type: 'number',
          description: 'Deadline timestamp (ms since epoch, optional)',
        })
        .option('idempotency-key', {
          alias: 'k',
          type: 'string',
          description:
            'Optional Idempotency-Key for safe retry (server dedupes 24h). ' +
            'Default: auto-generated from uuid+title+publisher.',
        })
        .option('json', {
          type: 'boolean',
          default: false,
          description: 'Output result as JSON (programmatic parsing).',
        })
        .option('quiet', {
          alias: 'q',
          type: 'boolean',
          default: false,
          description: 'Suppress decorative output (errors still printed to stderr).',
        })
    ),

  handler: async (argv) => {
    const baseUrl = resolveServerUrl(argv['server-url'], bountyConfig.apiUrl);

    const validated = validatePublishInput(argv as Record<string, unknown>);
    if (!validated.ok) {
      console.error(chalk.red(`\n${validated.error}\n`));
      process.exit(2);
    }
    const input = validated.value;

    const publisher = resolveAgentIdOption({
      address: argv['publisher-address'],
      deprecatedId: argv['publisher-id'],
      fallback: resolveCurrentAgent(),
      addressFlag: '--publisher-address',
      deprecatedFlag: '--publisher-id',
      missingMessage:
        '✗ Cannot infer publisher address. Provide --publisher-address or set BOUNTY_IM_ADDRESS.',
    });
    if (!publisher.ok) {
      console.error(chalk.red(`\n${publisher.error}\n`));
      process.exit(2);
    }
    const publisherId = publisher.value;

    // Resolve optional description: --description wins if both are given.
    let description: string | undefined = input.description;
    if (!description && input.descriptionFile) {
      const filePath = input.descriptionFile;
      if (!existsSync(filePath)) {
        console.error(chalk.red(`\n✗ --description-file: file not found: ${filePath}\n`));
        process.exit(2);
      }
      try {
        description = readFileSync(filePath, 'utf-8');
      } catch (err: any) {
        console.error(
          chalk.red(
            `\n✗ --description-file: cannot read ${filePath}: ` +
              (err instanceof Error ? err.message : String(err)) + '\n'
          )
        );
        process.exit(2);
      }
    }

    const idempotencyKey =
      input.idempotencyKey ||
      generateIdempotencyKey({
        uuid: resolveCurrentAgent() ?? publisherId,
        title: input.title,
        publisher: publisherId,
      });

    try {
      const task = await bountyHttp<BountyTask>({
        baseUrl,
        path: '/api/tasks',
        method: 'POST',
        body: {
          title: input.title,
          description,
          type: input.type,
          reward: input.reward,
          tags: input.tags,
          deadline: input.deadline,
          // Server still accepts legacy id field; CLI derives it from address.
          publisherId,
        },
        extraHeaders: {
          'Idempotency-Key': idempotencyKey,
          'X-Agent-Id': publisherId,
        },
      });

      if (shouldJson(argv)) {
        jsonOutput(task);
      } else if (isQuiet(argv)) {
        quietIdOutput(task);
      } else {
        console.log(chalk.green('\n✓ Task published successfully\n'));
        console.log(chalk.cyan('  ID:'), task.id);
        console.log(chalk.cyan('  Title:'), task.title);
        console.log(chalk.cyan('  Type:'), task.type);
        console.log(chalk.cyan('  Reward:'), task.reward, 'credits');
        console.log(chalk.cyan('  Status:'), task.status);
        if (task.tags && task.tags.length > 0) {
          console.log(chalk.cyan('  Tags:'), task.tags.join(', '));
        }
        console.log();
      }
    } catch (error: any) {
      handleBountyError(error, 'publish task', baseUrl);
    }
  },
};

/**
 * Centralized error handler for bounty-task HTTP errors.
 * Provides user-friendly messages based on error type.
 *
 * Exit code mapping:
 * - 2: usage error / business validation
 * - 3: auth required
 * - 4: network / server issue
 */
export function handleBountyError(error: any, action: string, baseUrl: string): never {
  if (error instanceof BountyHttpError) {
    console.error(chalk.red(`\n✗ Failed to ${action}:`));
    console.error(chalk.red(`  ${error.message}\n`));

    if (error.status === 409 && error.currentOwner) {
      const co = error.currentOwner;
      const display = co.name ? `${co.name} <${co.email}>` : co.email ?? co.id;
      console.error(
        chalk.yellow(
          `  💡 This task is already ${error.currentStatus ?? 'taken'}; ` +
            `currently held by ${display}.`
        )
      );
      console.error();
    }

    const exitCode =
      error.type === 'auth' ? 3 :
      error.type === 'network' || error.type === 'server' ? 4 :
      2;
    process.exit(exitCode);
  }

  console.error(
    chalk.red(`\n✗ Unexpected error while trying to ${action}:`),
    error instanceof Error ? error.message : String(error)
  );
  console.error(chalk.gray(`  Server: ${baseUrl}\n`));
  process.exit(1);
}
