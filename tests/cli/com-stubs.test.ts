/**
 * com connect / disconnect / config / addresses are stubs (H5)
 */

import { describe, it, expect } from 'bun:test';

const STUB_NOTICE = 'placeholder';
const STUB_FOOTER = 'No persistent connection is opened by this command.';

describe('com CLI stub commands (H5)', () => {
  it('exposes a shared STUB_NOTICE so all four commands advertise the same caveat', async () => {
    const mod = await import('../../src/cli/commands/com/stub');
    expect(mod.STUB_NOTICE).toContain(STUB_NOTICE);
    expect(mod.STUB_FOOTER).toContain(STUB_FOOTER);
  });

  it('emits a placeholder notice and the shared footer', async () => {
    const mod = await import('../../src/cli/commands/com/stub');
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map(a => String(a)).join(' '));
    };
    try {
      mod.printStubNotice('connect', { address: 'foo@bar' });
    } finally {
      console.log = original;
    }

    const all = lines.join('\n');
    expect(all.toLowerCase()).toContain(STUB_NOTICE);
    expect(all).toContain(STUB_FOOTER);
    // The user-supplied arguments must be reflected in the notice so
    // operators can verify what the command would have acted on.
    expect(all).toContain('foo@bar');
  });
});
