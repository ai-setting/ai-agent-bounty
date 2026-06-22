/**
 * Tests for bounty com discuss command
 *
 * The discuss command drives a scripted conversation between two or more
 * agents by replaying a JSON script of messages through the IM HTTP API.
 * Tests cover:
 *  - Script execution: each turn sent in order
 *  - HTTP delivery: server returns 2xx
 *  - Failure surfacing: one bad turn fails the whole run
 *  - Inbox verification: --show-inbox fetches each unique recipient
 *  - Script validation: missing fields rejected up front
 */

import { describe, test, expect } from 'bun:test';
import {
  executeDiscussScript,
  parseDiscussScript,
  validateDiscussScript,
  type DiscussMessage,
} from '../../src/cli/commands/com/discuss.js';

const HOST = 'localhost';
const PORT = 4001;

describe('com discuss - script parsing', () => {
  test('parses a well-formed script', () => {
    const raw = JSON.stringify([
      { from: 'a@x', to: 'b@x', body: 'hi' },
      { from: 'b@x', to: 'a@x', body: 'hey' },
    ]);
    const parsed = parseDiscussScript(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ from: 'a@x', to: 'b@x', body: 'hi' });
  });

  test('rejects non-array JSON', () => {
    expect(() => parseDiscussScript('{"foo": 1}')).toThrow(/array/i);
  });

  test('rejects empty array', () => {
    expect(() => parseDiscussScript('[]')).toThrow(/at least one/i);
  });

  test('rejects entry missing from', () => {
    expect(() => parseDiscussScript(JSON.stringify([
      { to: 'b@x', body: 'hi' },
    ]))).toThrow(/from/i);
  });

  test('rejects entry missing to', () => {
    expect(() => parseDiscussScript(JSON.stringify([
      { from: 'a@x', body: 'hi' },
    ]))).toThrow(/to/i);
  });

  test('rejects entry missing body', () => {
    expect(() => parseDiscussScript(JSON.stringify([
      { from: 'a@x', to: 'b@x' },
    ]))).toThrow(/body/i);
  });

  test('rejects entry with empty body', () => {
    expect(() => parseDiscussScript(JSON.stringify([
      { from: 'a@x', to: 'b@x', body: '' },
    ]))).toThrow(/body/i);
  });
});

describe('com discuss - executeDiscussScript', () => {
  /** Build a fake fetch that records calls and returns scripted responses. */
  function makeFakeFetch(responses: Array<{ status: number; body: any }>) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    let i = 0;
    const fn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const r = responses[i++] ?? { status: 500, body: { error: 'no more responses' } };
      return new Response(JSON.stringify(r.body), { status: r.status });
    }) as unknown as typeof fetch;
    return { fetch: fn, calls };
  }

  const noSleep = () => Promise.resolve();

  test('sends each message in order and returns 2xx results', async () => {
    const messages: DiscussMessage[] = [
      { from: 'alice@x', to: 'bob@x', body: 'hi' },
      { from: 'bob@x', to: 'alice@x', body: 'hey' },
      { from: 'alice@x', to: 'bob@x', body: 'bye' },
    ];
    const { fetch: fakeFetch, calls } = makeFakeFetch([
      { status: 201, body: { id: 'm1', from: 'alice@x', to: 'bob@x' } },
      { status: 201, body: { id: 'm2', from: 'bob@x', to: 'alice@x' } },
      { status: 201, body: { id: 'm3', from: 'alice@x', to: 'bob@x' } },
    ]);

    const report = await executeDiscussScript(messages, {
      host: HOST,
      port: PORT,
      delayMs: 0,
      showInbox: false,
      fetchImpl: fakeFetch,
      sleep: noSleep,
    });

    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe(`http://${HOST}:${PORT}/messages`);
    expect(JSON.parse(calls[0].init!.body as string)).toEqual({
      from: 'alice@x',
      to: 'bob@x',
      content: { type: 'text', body: 'hi' },
    });
    expect(report.results.every((r) => r.ok)).toBe(true);
    expect(report.totalSent).toBe(3);
  });

  test('surfaces a failed turn with status + body and stops the run', async () => {
    const messages: DiscussMessage[] = [
      { from: 'a@x', to: 'b@x', body: 'hi' },
      { from: 'b@x', to: 'a@x', body: 'fail' },
      { from: 'a@x', to: 'b@x', body: 'never sent' },
    ];
    const { fetch: fakeFetch, calls } = makeFakeFetch([
      { status: 201, body: { id: 'm1' } },
      { status: 401, body: { error: 'Unauthorized' } },
    ]);

    const report = await executeDiscussScript(messages, {
      host: HOST,
      port: PORT,
      delayMs: 0,
      showInbox: false,
      fetchImpl: fakeFetch,
      sleep: noSleep,
    });

    expect(calls).toHaveLength(2); // stopped after second turn
    expect(report.results[0].ok).toBe(true);
    expect(report.results[1].ok).toBe(false);
    expect(report.results[1].status).toBe(401);
    expect(report.results[1].error).toContain('Unauthorized');
  });

  test('fetches unique recipient inboxes when showInbox=true', async () => {
    const messages: DiscussMessage[] = [
      { from: 'alice@x', to: 'bob@x', body: 'hi' },
      { from: 'bob@x', to: 'alice@x', body: 'hey' },
    ];
    const { fetch: fakeFetch, calls } = makeFakeFetch([
      { status: 201, body: { id: 'm1' } },
      { status: 201, body: { id: 'm2' } },
      { status: 200, body: [{ id: 'm2', from: 'bob@x' }] }, // alice inbox
      { status: 200, body: [{ id: 'm1', from: 'alice@x' }] }, // bob inbox
    ]);

    const report = await executeDiscussScript(messages, {
      host: HOST,
      port: PORT,
      delayMs: 0,
      showInbox: true,
      fetchImpl: fakeFetch,
      sleep: noSleep,
    });

    expect(calls).toHaveLength(4);
    // Inbox queries for unique recipients, in order of first appearance
    expect(calls[2].url).toContain('address=alice%40x');
    expect(calls[3].url).toContain('address=bob%40x');
    expect(report.inboxByAgent).toBeDefined();
    expect(report.inboxByAgent!['alice@x']).toHaveLength(1);
    expect(report.inboxByAgent!['bob@x']).toHaveLength(1);
  });

  test('does not call inbox endpoint when showInbox=false', async () => {
    const messages: DiscussMessage[] = [
      { from: 'a@x', to: 'b@x', body: 'hi' },
    ];
    const { fetch: fakeFetch, calls } = makeFakeFetch([
      { status: 201, body: { id: 'm1' } },
    ]);

    await executeDiscussScript(messages, {
      host: HOST,
      port: PORT,
      delayMs: 0,
      showInbox: false,
      fetchImpl: fakeFetch,
      sleep: noSleep,
    });

    expect(calls).toHaveLength(1);
  });
});

describe('com discuss - validateDiscussScript', () => {
  test('returns parsed messages for valid input', () => {
    const out = validateDiscussScript(JSON.stringify([
      { from: 'a', to: 'b', body: 'hi' },
    ]));
    expect(out).toHaveLength(1);
  });

  test('throws on invalid JSON', () => {
    expect(() => validateDiscussScript('not json')).toThrow();
  });
});