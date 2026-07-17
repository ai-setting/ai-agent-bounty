/**
 * PR5 --help grouping tests.
 *
 * Validates the renderHelp contract directly (pure function, no yargs wiring):
 * - Default mode prints three groups (Bounty / Common / Quickstart)
 * - --all flag triggers the legacy full-list mode (placeholder text)
 * - scriptName + commonOptions are echoed
 * - All listed command names appear in default output
 */

import { describe, test, expect } from 'bun:test';
import { renderHelp } from '../../../src/cli/lib/help-groups.js';

const SAMPLE_GROUPS = [
  {
    title: 'Bounty',
    description: 'bounty 专属命令',
    commandNames: ['auth', 'profile', 'bounty-task', 'com', 'register-agent', 'server'],
  },
  {
    title: 'Common',
    description: 'roy-agent-cli 通用命令',
    commandNames: ['act', 'interactive', 'sessions', 'tasks', 'commands', 'memory', 'skills', 'tools', 'mcp'],
  },
  {
    title: 'Quickstart',
    description: '新手 4 命令',
    commandNames: ['help', 'status', 'whoami', 'quickstart'],
  },
];

const SAMPLE_OPTIONS = [
  {
    keys: ['--profile', '-P'],
    description: 'Use the named profile (overrides BOUNTY_PROFILE and active_profile)',
  },
  {
    keys: ['--quiet'],
    description: 'Quiet mode (default: on, use --no-quiet to enable logging)',
  },
];

describe('renderHelp (PR5 --help grouping)', () => {
  test('default mode shows all three groups + their command names', () => {
    const out = renderHelp({
      groups: SAMPLE_GROUPS,
      commonOptions: SAMPLE_OPTIONS,
      showAll: false,
      scriptName: 'bounty',
    });
    expect(out.allFlag).toBe(false);
    expect(out.text).toContain('bounty <command>');
    for (const g of SAMPLE_GROUPS) {
      expect(out.text).toContain(g.title);
      expect(out.text).toContain(g.description);
      for (const cmd of g.commandNames) {
        expect(out.text).toContain(cmd);
      }
    }
  });

  test('allFlag=true produces the legacy compatibility marker', () => {
    const out = renderHelp({
      groups: SAMPLE_GROUPS,
      commonOptions: SAMPLE_OPTIONS,
      showAll: true,
      scriptName: 'bounty',
    });
    expect(out.allFlag).toBe(true);
    expect(out.text.toLowerCase()).toMatch(/all commands shown|no grouping/);
    // Should NOT enumerate the groups when --all is set
    expect(out.text).not.toContain('Bounty');
    expect(out.text).not.toContain('Quickstart');
  });

  test('global options are echoed with keys + description', () => {
    const out = renderHelp({
      groups: SAMPLE_GROUPS,
      commonOptions: SAMPLE_OPTIONS,
      showAll: false,
      scriptName: 'bounty',
    });
    expect(out.text).toContain('--profile');
    expect(out.text).toContain('-P');
    expect(out.text).toContain('Use the named profile');
    expect(out.text).toContain('--quiet');
    expect(out.text).toContain('Quiet mode');
  });

  test('Tip mentions --all for users who want the full command list', () => {
    const out = renderHelp({
      groups: SAMPLE_GROUPS,
      commonOptions: SAMPLE_OPTIONS,
      showAll: false,
      scriptName: 'bounty',
    });
    expect(out.text).toMatch(/--all/i);
  });

  test('scriptName is reflected in the usage banner', () => {
    const out = renderHelp({
      groups: SAMPLE_GROUPS,
      commonOptions: [],
      showAll: false,
      scriptName: 'mycli',
    });
    expect(out.text).toContain('mycli <command>');
  });
});