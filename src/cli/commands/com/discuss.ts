/**
 * bounty com discuss command
 *
 * Drives a scripted conversation between two or more agents by
 * replaying a JSON script of messages through the Agent IM HTTP API.
 * Each entry in the script is a single turn:
 *
 *   { "from": "<agent-address>", "to": "<agent-address>", "body": "..." }
 *
 * The command sends each turn in order, optionally with a delay between
 * turns, and (with --show-inbox) verifies what each unique recipient
 * actually received. Used for demos, integration tests, and scripted
 * agent-to-agent flows.
 */

import type { CommandModule } from 'yargs';
import { readFileSync, existsSync } from 'fs';
import chalk from 'chalk';
import { bountyConfig } from '../../../lib/config/bounty-config.js';

// ============ Public types ============

export interface DiscussMessage {
  from: string;
  to: string;
  body: string;
}

export interface SendResult {
  index: number;
  from: string;
  to: string;
  body: string;
  ok: boolean;
  status: number;
  id?: string;
  error?: string;
}

export interface DiscussReport {
  totalSent: number;
  results: SendResult[];
  inboxByAgent?: Record<string, InboxEntry[]>;
}

export interface InboxEntry {
  id: string;
  from: string;
  to: string;
  status?: string;
  [key: string]: unknown;
}

export interface ExecuteOptions {
  host: string;
  port: number;
  delayMs: number;
  showInbox: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

// ============ Script parsing / validation ============

const FIELD_LABELS: Record<keyof DiscussMessage, string> = {
  from: 'from',
  to: 'to',
  body: 'body',
};

/**
 * Parses a raw JSON string into a list of DiscussMessage.
 * Throws a human-readable error if the script is malformed.
 */
export function parseDiscussScript(raw: string): DiscussMessage[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Script is not valid JSON: ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Script must be a JSON array of {from, to, body} entries');
  }
  if (parsed.length === 0) {
    throw new Error('Script must contain at least one message');
  }

  return parsed.map((entry, i) => validateEntry(entry, i));
}

function validateEntry(entry: unknown, index: number): DiscussMessage {
  if (entry === null || typeof entry !== 'object') {
    throw new Error(`Entry #${index + 1} is not an object`);
  }
  const e = entry as Record<string, unknown>;
  const msg: Partial<DiscussMessage> = {};
  for (const key of Object.keys(FIELD_LABELS) as Array<keyof DiscussMessage>) {
    const v = e[key];
    if (typeof v !== 'string') {
      throw new Error(`Entry #${index + 1} is missing or has non-string "${FIELD_LABELS[key]}"`);
    }
    if (key === 'body' && v.length === 0) {
      throw new Error(`Entry #${index + 1} has empty "body"`);
    }
    msg[key] = v;
  }
  return msg as DiscussMessage;
}

/**
 * Convenience wrapper: read & parse a script from disk in one call.
 */
export function validateDiscussScript(raw: string): DiscussMessage[] {
  return parseDiscussScript(raw);
}

// ============ Core execution ============

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Replays a script of messages through the IM HTTP API.
 *
 * Behavior:
 *  - Sends each turn in order, with optional delay between turns.
 *  - Stops the run on the first non-2xx response; later turns are skipped.
 *  - If showInbox is true, queries the inbox of each unique recipient
 *    in first-appearance order and includes the result in the report.
 *
 * The fetch and sleep functions are injectable for testing.
 */
export async function executeDiscussScript(
  messages: DiscussMessage[],
  options: ExecuteOptions,
): Promise<DiscussReport> {
  const f = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const baseUrl = `http://${options.host}:${options.port}`;

  const results: SendResult[] = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const url = `${baseUrl}/messages`;

    let result: SendResult;
    try {
      const response = await f(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: m.from,
          to: m.to,
          content: { type: 'text', body: m.body },
        }),
      });

      let body: any = null;
      try {
        body = await response.json();
      } catch {
        // ignore: server may return non-JSON on error
      }

      result = {
        index: i,
        from: m.from,
        to: m.to,
        body: m.body,
        ok: response.ok,
        status: response.status,
        id: body?.id,
        error: response.ok ? undefined : (body?.error ?? body?.message ?? `HTTP ${response.status}`),
      };
    } catch (err) {
      result = {
        index: i,
        from: m.from,
        to: m.to,
        body: m.body,
        ok: false,
        status: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    results.push(result);

    if (!result.ok) {
      // Stop the run on first failure; surface the partial transcript.
      break;
    }

    if (i < messages.length - 1 && options.delayMs > 0) {
      await sleep(options.delayMs);
    }
  }

  let inboxByAgent: Record<string, InboxEntry[]> | undefined;
  if (options.showInbox) {
    inboxByAgent = {};
    const seen = new Set<string>();
    // Collect every unique participant (both from and to) in order of
    // first appearance in the script. This shows "what did each side of
    // the conversation receive" in a natural left-to-right reading order.
    for (const m of messages) {
      for (const participant of [m.from, m.to]) {
        if (!seen.has(participant)) {
          seen.add(participant);
          inboxByAgent[participant] = await fetchInbox(baseUrl, participant, f);
        }
      }
    }
  }

  return {
    totalSent: results.filter((r) => r.ok).length,
    results,
    inboxByAgent,
  };
}

async function fetchInbox(
  baseUrl: string,
  address: string,
  f: typeof fetch,
): Promise<InboxEntry[]> {
  const url = `${baseUrl}/messages?address=${encodeURIComponent(address)}`;
  try {
    const response = await f(url);
    if (!response.ok) return [];
    const messages = (await response.json()) as InboxEntry[];
    return Array.isArray(messages) ? messages : [];
  } catch {
    return [];
  }
}

// ============ Pretty-printing (CLI output) ============

export function printDiscussReport(report: DiscussReport): void {
  console.log(chalk.bold('\n📜 Discuss transcript:\n'));
  for (const r of report.results) {
    if (r.ok) {
      console.log(chalk.green(`  [${r.index + 1}] ✓ ${r.from} → ${r.to}`));
      console.log(chalk.gray(`      ${r.body}`));
    } else {
      console.log(chalk.red(`  [${r.index + 1}] ✗ ${r.from} → ${r.to} (HTTP ${r.status})`));
      console.log(chalk.gray(`      ${r.body}`));
      if (r.error) console.log(chalk.red(`      error: ${r.error}`));
    }
  }
  console.log();
  console.log(chalk.cyan(`  Total delivered: ${report.totalSent}/${report.results.length}`));

  if (report.inboxByAgent) {
    console.log(chalk.bold('\n📥 Inbox snapshot:\n'));
    for (const [address, msgs] of Object.entries(report.inboxByAgent)) {
      console.log(chalk.cyan(`  ${address} (${msgs.length} message${msgs.length === 1 ? '' : 's'}):`));
      for (const m of msgs) {
        const body = (m as any).content?.body ?? '(no body)';
        const preview = String(body).slice(0, 80).replace(/\n/g, ' ');
        console.log(chalk.gray(`    ← from ${m.from}: ${preview}${String(body).length > 80 ? '…' : ''}`));
      }
      console.log();
    }
  }
}

// ============ Yargs command ============

interface DiscussCliOptions {
  script: string;
  delay?: number;
  showInbox?: boolean;
  host?: string;
  port?: number;
}

export const discussCommand: CommandModule<object, DiscussCliOptions> = {
  command: 'discuss',
  describe: 'Drive a scripted conversation between agents via IM',

  builder: (yargs) =>
    yargs
      .option('script', {
        alias: 's',
        type: 'string',
        demandOption: true,
        description: 'Path to a JSON script of messages',
      })
      .option('delay', {
        alias: 'd',
        type: 'number',
        default: 300,
        description: 'Delay in ms between messages (default 300)',
      })
      .option('show-inbox', {
        alias: 'i',
        type: 'boolean',
        default: false,
        description: 'Fetch each recipient inbox after the run',
      })
      .option('host', {
        alias: 'H',
        type: 'string',
        description: 'IM server host',
        default: bountyConfig.host,
      })
      .option('port', {
        alias: 'p',
        type: 'number',
        description: 'IM server port',
        default: bountyConfig.port,
      }),

  handler: async (args) => {
    const { script: scriptPath, delay = 300, showInbox = false, host, port } = args;

    if (!scriptPath) {
      console.error(chalk.red('\n✗ Error: --script <path> is required\n'));
      process.exit(2);
    }
    if (!existsSync(scriptPath)) {
      console.error(chalk.red(`\n✗ Error: script file not found: ${scriptPath}\n`));
      process.exit(2);
    }

    const raw = readFileSync(scriptPath, 'utf-8');
    let messages: DiscussMessage[];
    try {
      messages = parseDiscussScript(raw);
    } catch (err) {
      console.error(chalk.red(`\n✗ Script error: ${(err as Error).message}\n`));
      process.exit(2);
    }

    console.log(chalk.cyan(`\n🎙  Running discuss script: ${messages.length} turn(s)`));
    console.log(chalk.gray(`   server: http://${host}:${port}`));
    console.log(chalk.gray(`   delay:  ${delay}ms`));
    console.log(chalk.gray(`   inbox:  ${showInbox ? 'on' : 'off'}`));
    console.log();

    const report = await executeDiscussScript(messages, {
      host: host!,
      port: port!,
      delayMs: delay,
      showInbox,
    });

    printDiscussReport(report);

    if (report.totalSent < messages.length) {
      process.exit(1);
    }
  },
};