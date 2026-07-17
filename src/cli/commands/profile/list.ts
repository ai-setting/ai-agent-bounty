/**
 * bounty profile list [--json]
 *
 * PR2: Show every profile on disk. The currently active profile (resolved via
 * PR1's `resolveActiveProfile` so CLI / env / config all work) is prefixed
 * with `*` in the human-readable table. `--json` prints a token-free
 * summary suitable for shell pipelines.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import {
  listProfiles,
  loadProfile,
  readGlobalConfig,
  type StoreOptions,
} from '../../config/store.js';
import { resolveActiveProfile } from '../../config/resolver.js';
import { DEFAULT_PROFILE_NAME } from '../../config/paths.js';
import type { BountyProfile } from '../../config/types.js';

interface ListOptions {
  json?: boolean;
}

function buildStoreOptions(argv: Record<string, unknown>): StoreOptions {
  const raw = argv.__storeOptions;
  if (raw && typeof raw === 'object') return raw as StoreOptions;
  return {};
}

interface ProfileSummary {
  name: string;
  api_base: string;
  agent_id?: string;
  email?: string;
  scope_count: number;
  last_used_at?: number;
}

function summarize(p: BountyProfile): ProfileSummary {
  return {
    name: p.name,
    api_base: p.api_base,
    agent_id: p.agent_id,
    email: p.email,
    scope_count: p.auth.scope?.length ?? 0,
    last_used_at: p.last_used_at,
  };
}

function formatTimestamp(unix: number | undefined): string {
  if (!unix) return '—';
  const d = new Date(unix * 1000);
  // YYYY-MM-DD HH:mm UTC; intentionally terse for the table.
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
}

export const listCommand: CommandModule<object, ListOptions> = {
  command: 'list',
  describe: 'List all profiles',
  aliases: ['ls'],
  builder: (yargs) =>
    yargs.option('json', {
      type: 'boolean',
      default: false,
      description: 'Emit machine-readable JSON (no tokens)',
    }),

  handler: async (argv) => {
    const opts = buildStoreOptions(argv as Record<string, unknown>);

    const names = listProfiles(opts);
    const profiles = names
      .map((name) => loadProfile(name, opts))
      .filter((p): p is BountyProfile => p !== null);

    // Resolve active profile using PR1 resolver so --profile/BOUNTY_PROFILE
    // win over the on-disk config (consistent with the rest of PR2).
    const cliProfile = typeof argv.profile === 'string' && argv.profile.trim().length > 0
      ? argv.profile.trim()
      : null;
    const resolved = resolveActiveProfile(cliProfile, opts);
    let active = resolved.source === 'default' && !existsConfig(opts)
      ? DEFAULT_PROFILE_NAME
      : resolved.name;

    // If the resolver did not pick up an explicit override (cli/env), fall
    // back to the on-disk config's active_profile. A `cli` source means
    // --profile was honored; we MUST NOT overwrite it with the config value.
    const cfg = readGlobalConfig(opts);
    if (resolved.source !== 'cli' && cfg?.active_profile) {
      active = cfg.active_profile;
    }

    if (argv.json) {
      const payload = {
        active,
        profiles: profiles.map(summarize),
      };
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    if (profiles.length === 0) {
      console.log(chalk.yellow('No profiles found.'));
      console.log(chalk.cyan(`  Create one with: bounty profile add <name> --api-base <url>`));
      return;
    }

    // Human-readable table
    const rows: Array<{ active: string; name: string; api: string; agent: string; scopes: string; used: string }> = profiles.map((p) => {
      const summary = summarize(p);
      return {
        active: p.name === active ? '*' : ' ',
        name: p.name,
        api: summary.api_base,
        agent: summary.agent_id ?? '—',
        scopes: summary.scope_count.toString(),
        used: formatTimestamp(summary.last_used_at),
      };
    });
    rows.sort((a, b) => a.name.localeCompare(b.name));

    const headers = ['', 'NAME', 'API_BASE', 'AGENT_ID', 'SCOPES', 'LAST_USED'];
    const widths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => stripAnsi(rowForColumn(r, i)).length)),
    );

    const formatRow = (cells: string[]) =>
      cells.map((c, i) => padRight(c, widths[i] ?? 0)).join('  ');

    console.log(chalk.bold(formatRow(headers)));
    console.log(chalk.gray(formatRow(widths.map((w) => '-'.repeat(w)))));
    for (const row of rows) {
      const cells = [row.active, row.name, row.api, row.agent, row.scopes, row.used];
      const formatted = formatRow(cells);
      console.log(row.active === '*' ? chalk.cyan(formatted) : formatted);
    }
    console.log(chalk.gray(`\nActive profile: ${chalk.cyan(active)}`));
  },
};

function rowForColumn(r: { active: string; name: string; api: string; agent: string; scopes: string; used: string }, i: number): string {
  switch (i) {
    case 0: return r.active;
    case 1: return r.name;
    case 2: return r.api;
    case 3: return r.agent;
    case 4: return r.scopes;
    case 5: return r.used;
    default: return '';
  }
}

function padRight(s: string, width: number): string {
  const stripped = stripAnsi(s);
  const gap = width - stripped.length;
  return gap > 0 ? s + ' '.repeat(gap) : s;
}

function stripAnsi(s: string): string {
  // Chalk may inject ANSI escapes; we only need the visible length.
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

function existsConfig(opts: StoreOptions): boolean {
  // Avoid pulling fs into the hot path; reuse readGlobalConfig semantics.
  const cfg = readGlobalConfig(opts);
  return cfg !== null;
}

export default listCommand;
