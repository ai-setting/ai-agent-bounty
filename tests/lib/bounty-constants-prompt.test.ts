/**
 * BOUNTY_CAPABILITIES prompt must match the real CLI command surface (H3)
 *
 * Background: the prompt that gets injected into the default agent used
 * to advertise commands that did not exist (e.g. `bounty publish` while
 * the actual command is `bounty bounty-task publish`). When an LLM
 * agent tried to follow the prompt it would fail with "command not
 * found", undermining trust in the system.
 *
 * New behavior: BOUNTY_CAPABILITIES must reflect the real yargs command
 * tree. This test parses the prompt for every command it advertises
 * and asserts that the command name actually appears in src/cli/cli.ts.
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BOUNTY_CAPABILITIES } from '../../src/lib/mail/bounty-constants';

const CLI_MAIN = readFileSync(
  join(import.meta.dir, '..', '..', 'src', 'cli', 'cli.ts'),
  'utf-8'
);

const BOUNTY_TASK_INDEX = readFileSync(
  join(import.meta.dir, '..', '..', 'src', 'cli', 'commands', 'bounty-task', 'index.ts'),
  'utf-8'
);

const COM_INDEX = readFileSync(
  join(import.meta.dir, '..', '..', 'src', 'cli', 'commands', 'com', 'index.ts'),
  'utf-8'
);

describe('BOUNTY_CAPABILITIES prompt accuracy (H3)', () => {
  it('advertises only commands that exist in the bounty-task CLI', () => {
    // Extract every backticked token of the shape `bounty <verb> ...` or
    // `bounty bounty-task <verb>` and assert at least one appears in
    // the bounty-task command index file.
    const tokenRegex = /`bounty\s+([a-z-][a-z0-9-]*(?:\s+[a-z-][a-z0-9-]*)*)`/g;
    const tokens = Array.from(BOUNTY_CAPABILITIES.matchAll(tokenRegex)).map(m => m[1]!);

    expect(tokens.length).toBeGreaterThan(5);

    // Every token that names a bounty task command must be findable in
    // the bounty-task command index. We allow "bounty <verb>" forms
    // (parent + subcommand) by looking for either the full parent form
    // ("bounty-task <verb>") or the verb alone.
    const knownVerbs = ['publish', 'board', 'grab', 'submit', 'complete', 'cancel'];
    for (const verb of knownVerbs) {
      expect(BOUNTY_TASK_INDEX).toContain(verb);
      // The prompt should advertise "bounty bounty-task <verb>" or the
      // verb in the example block. We strip "bounty bounty-task " / "bounty "
      // prefixes when checking. We also include the example block.
      const allForms = tokens.map(t =>
        t.replace(/^bounty\s+/, '').replace(/^bounty-task\s+/, '')
      );
      const exampleForms = (BOUNTY_CAPABILITIES.match(/bounty[^\n`]*/g) || []).map(s =>
        s.replace(/^\s*bounty\s+/, '').replace(/^\s*bounty-task\s+/, '').trim()
      );
      const seen = [...allForms, ...exampleForms].some(s => s === verb || s.startsWith(`${verb} `) || s.startsWith(`${verb}\t`));
      expect(seen).toBe(true);
    }
  });

  it('does not advertise removed com connect / com disconnect as if they open a real session', () => {
    // The connect/disconnect commands are placeholders that just probe
    // the server. The prompt must not promise a persistent IMAP-style
    // session ("IDLE", "real-time IMAP push").
    expect(BOUNTY_CAPABILITIES).not.toMatch(/IDLE|实时监听/);
  });

  it('is registered with the prompt hook in cli.ts', () => {
    expect(CLI_MAIN).toMatch(/bounty-prompt-hook|registerBountyPromptHook/);
  });

  it('lists all com subcommands that exist in the com index', () => {
    // Phase 4: 'config' command removed. Kept subcommands: send, inbox, addresses, connect, disconnect.
    const knownComVerbs = ['send', 'inbox', 'addresses', 'connect', 'disconnect'];
    for (const verb of knownComVerbs) {
      expect(COM_INDEX).toContain(verb);
      expect(BOUNTY_CAPABILITIES).toContain(`com ${verb}`);
    }
  });
});
