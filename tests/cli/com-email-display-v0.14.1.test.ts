/**
 * v0.14.1: Tests for CLI display of registered emails in `bounty com send`
 * and `bounty com inbox`.
 *
 * Background (v0.14.0 bug):
 *   CLI displayed `From: <uuid>@authenticated` to users. Users wanted to see
 *   the registered email (e.g. `alice@example.com`) instead.
 *
 * v0.14.1 expected behaviour:
 *   T1: com send.ts source uses message.from_email (not message.from) for display
 *   T2: com send.ts source uses message.to_email (not message.to) for display
 *   T3: com inbox.ts source uses msg.from_email (not msg.from) for display
 *   T4: com inbox.ts source uses msg.to_email (not msg.to) for display
 *   T5: Both commands fall back to canonical when email is missing
 *       (backward compat with v0.14.0 servers)
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const SEND_SRC = resolve(
  import.meta.dir,
  "../../src/cli/commands/com/send.ts",
);
const INBOX_SRC = resolve(
  import.meta.dir,
  "../../src/cli/commands/com/inbox.ts",
);

describe("CLI com send / com inbox — v0.14.1 email display", () => {
  test("T1: com send.ts source prefers message.from_email over message.from for display", () => {
    const src = readFileSync(SEND_SRC, "utf-8");
    // v0.14.1: registered email takes precedence in the display block
    expect(src).toMatch(/message\.from_email/);
  });

  test("T2: com send.ts source prefers message.to_email over message.to for display", () => {
    const src = readFileSync(SEND_SRC, "utf-8");
    expect(src).toMatch(/message\.to_email/);
  });

  test("T3: com inbox.ts source prefers msg.from_email over msg.from for display", () => {
    const src = readFileSync(INBOX_SRC, "utf-8");
    expect(src).toMatch(/msg\.from_email/);
  });

  test("T4: com inbox.ts source prefers msg.to_email over msg.to for display", () => {
    const src = readFileSync(INBOX_SRC, "utf-8");
    expect(src).toMatch(/msg\.to_email/);
  });

  test("T5: both commands fall back to canonical from / to when email is missing", () => {
    const sendSrc = readFileSync(SEND_SRC, "utf-8");
    const inboxSrc = readFileSync(INBOX_SRC, "utf-8");
    // Sanity: the display blocks must NOT omit the canonical fallback
    // when the server didn't enrich the response (v0.14.0 servers).
    expect(sendSrc).toMatch(/message\.from_email/);
    expect(sendSrc).toMatch(/\|\|\s*message\.from/);
    expect(sendSrc).toMatch(/message\.to_email/);
    expect(sendSrc).toMatch(/\|\|\s*message\.to/);
    expect(inboxSrc).toMatch(/msg\.from_email/);
    expect(inboxSrc).toMatch(/\|\|\s*msg\.from/);
    expect(inboxSrc).toMatch(/msg\.to_email/);
    expect(inboxSrc).toMatch(/\|\|\s*msg\.to/);
  });
});