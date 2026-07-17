/**
 * bounty publish command
 *
 * v0.7: address-based publisher identity + tolerant optional fields.
 *
 * Phase feat/bounty-task-profile (PR7): 改用 ProfileContext 决定 API base，
 *   与 auth/* 命令族行为一致：`--server-url` > active profile.api_base > API_BASE。
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { API_BASE } from '../../config.js';
import { ProfileContext } from '../../config/context.js';
import { resolveProfileApiBase } from '../../lib/profile-api-base.js';
import { addServerUrlOption, resolveServerUrl } from '../../lib/server-url-option.js';
import { bountyHttp, BountyHttpError } from '../../lib/bounty-http.js';
import { resolveCurrentAgent, resolveCurrentAgentAddress } from '../../lib/current-agent.js';
import { generateIdempotencyKey } from '../../lib/idempotency-key.js';
import { shouldJson, jsonOutput, isQuiet, quietIdOutput } from '../../lib/json-output.js';
import { resolveAddressOption } from '../../lib/address-parser.js';
import { validatePublishInput } from '../../lib/input-validator.js';

interface PublishOptions {
  title: string;
  description?: string;
  'description-file'?: string;
  type: string;
  reward: number | string;
  'publisher-address'?: string;
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
            'Publisher agent address in <uuid>@<host> format. ' +
            'Required (<uuid>@<host>) — bare UUID is REJECTED in v0.10. ' +
            'Defaults to BOUNTY_IM_ADDRESS env.',
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
    const profile = ProfileContext.getActive();
    const baseUrl = resolveProfileApiBase({
      cliServerUrl: argv['server-url'] as string | undefined,
      fallbackApiBase: API_BASE,
      profile,
      resolveServerUrlFn: resolveServerUrl,
    });

    const validated = validatePublishInput(argv as Record<string, unknown>);
    if (!validated.ok) {
      console.error(chalk.red(`\n${validated.error}\n`));
      process.exit(2);
    }
    const input = validated.value;

    const publisher = resolveAddressOption({
      address: argv['publisher-address'],
      fallback: resolveCurrentAgentAddress(),
      addressFlag: '--publisher-address',
      missingMessage:
        '✗ Cannot infer publisher address. Provide --publisher-address or set BOUNTY_IM_ADDRESS=<uuid>@<host>.',
    });
    if (!publisher.ok) {
      console.error(chalk.red(`\n${publisher.error}\n`));
      process.exit(2);
    }
    const publisherUuid = publisher.value.uuid;
    const publisherAddress = publisher.value.raw;

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
        uuid: resolveCurrentAgent() ?? publisherUuid,
        title: input.title,
        publisher: publisherUuid,
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
          // v0.10: send full `<uuid>@<host>` address (BREAKING — server rejects bare UUID)
          publisherAddress,
        },
        extraHeaders: {
          'Idempotency-Key': idempotencyKey,
          // Soft-auth compatibility: X-Agent-Id header still carries bare uuid
          'X-Agent-Id': publisherUuid,
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
