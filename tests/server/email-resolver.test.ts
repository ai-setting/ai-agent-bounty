/**
 * v0.14 strict email-only resolver — RED test matrix.
 *
 * This file documents the new contract for actor identity at the server
 * boundary:
 *   - Input MUST be a registered email shape (`local@domain.tld`)
 *   - `<uuid>@<host>` and bare UUIDs MUST be rejected (no silent fallback)
 *   - Server returns a discriminated `{ok, ...}` result for surface validation
 *   - `findAgentByEmail` returns the canonical row triple (id/email/address)
 *   - `formatCanonicalAddress` is a pure helper retained for IM routing
 *
 * Replaces the v0.13 dual-path resolver (`findAgentByEmailOrAddress`).
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  parseEmail,
  findAgentByEmail,
  formatCanonicalAddress,
} from "../../src/lib/email-resolver.js";

describe("parseEmail (v0.14 strict)", () => {
  test("accepts a registered-shape email", () => {
    const result = parseEmail("alice@example.com", "email");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("alice@example.com");
    }
  });

  test("accepts plus-tag and subdomain emails", () => {
    expect(parseEmail("alice+tag@host.example.com", "email").ok).toBe(true);
    expect(parseEmail("a.b-c@x.y.example", "email").ok).toBe(true);
  });

  test("REJECTS <uuid>@<host> (legacy address form)", () => {
    const result = parseEmail(
      "8de9b6aa-5781-4000-8000-000000000001@bounty.local",
      "email",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Must include a "use --email" hint so callers know what to do.
      expect(result.error.toLowerCase()).toMatch(/email/);
    }
  });

  test("REJECTS bare UUID", () => {
    expect(
      parseEmail("8de9b6aa-5781-4000-8000-000000000001", "email").ok,
    ).toBe(false);
  });

  test("REJECTS empty / whitespace / non-string", () => {
    expect(parseEmail("", "email").ok).toBe(false);
    expect(parseEmail("   ", "email").ok).toBe(false);
    expect(parseEmail(null, "email").ok).toBe(false);
    expect(parseEmail(undefined, "email").ok).toBe(false);
    expect(parseEmail(42, "email").ok).toBe(false);
    expect(parseEmail({}, "email").ok).toBe(false);
  });

  test("REJECTS surrounding whitespace (no implicit trim)", () => {
    // v0.14 strict: boundary must reject, not normalize.
    expect(parseEmail(" alice@example.com", "email").ok).toBe(false);
    expect(parseEmail("alice@example.com ", "email").ok).toBe(false);
    expect(parseEmail(" alice@example.com ", "email").ok).toBe(false);
    expect(parseEmail("\talice@example.com", "email").ok).toBe(false);
    expect(parseEmail("alice@example.com\n", "email").ok).toBe(false);
  });

  test("REJECTS malformed emails (no @, no dot, leading @, trailing @)", () => {
    for (const bad of ["alice@", "@example.com", "alice.example.com", "alice@@b.com"]) {
      const r = parseEmail(bad, "email");
      expect(r.ok).toBe(false);
    }
  });

  test("REJECTS empty / consecutive / leading / trailing dots in domain", () => {
    // Each domain label MUST be non-empty.
    expect(parseEmail("alice@.example.com", "email").ok).toBe(false); // leading dot
    expect(parseEmail("alice@example..com", "email").ok).toBe(false); // consecutive dots
    expect(parseEmail("alice@example.com.", "email").ok).toBe(false); // trailing dot
    expect(parseEmail("alice@.com", "email").ok).toBe(false);         // empty first label
    expect(parseEmail("alice@example.", "email").ok).toBe(false);      // empty TLD
    expect(parseEmail("alice@.", "email").ok).toBe(false);            // empty domain
    expect(parseEmail("alice@..", "email").ok).toBe(false);           // all-empty domain
  });

  test("REJECTS inputs that exceed DNS 254-char length cap", () => {
    const huge = "a".repeat(250) + "@example.com"; // 261 chars
    expect(parseEmail(huge, "email").ok).toBe(false);
  });

  test("exact remediation hint present for every rejection", () => {
    const cases = [
      "",
      "alice@",
      "8de9b6aa-5781-4000-8000-000000000001@bounty.local",
      " alice@example.com",
      "alice@example.com.",
      null,
    ];
    for (const bad of cases) {
      const r = parseEmail(bad as unknown, "email");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error).toMatch(/use --email <your-registered-email>/);
      }
    }
  });

  test("HTTP-field hint produces HTTP-shaped remediation, not CLI-shaped", () => {
    const r = parseEmail("alice@", "publisherEmail", "http");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // HTTP field hint must NOT prefix CLI-style '--' on camelCase field names.
      expect(r.error).not.toMatch(/--publisherEmail/);
      // HTTP field hint uses surface-appropriate phrasing instead.
      expect(r.error).toMatch(/use publisherEmail: <your-registered-email>/);
    }
  });

  test("CLI-surface hint defaults to '--<field>' form", () => {
    const r = parseEmail("alice@", "email"); // default surface = "cli"
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/use --email <your-registered-email>/);
    }
  });
});

describe("findAgentByEmail (v0.14 strict)", () => {
  // In-memory SQLite seeded with a single agent per test.
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE agents (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        address TEXT UNIQUE NOT NULL
      );
    `);
    db.prepare(
      "INSERT INTO agents (id, email, address) VALUES (?, ?, ?)",
    ).run(
      "8de9b6aa-5781-4000-8000-000000000001",
      "alice@example.com",
      "8de9b6aa-5781-4000-8000-000000000001@bounty.local",
    );
  });

  test("returns {id, email, address} for registered email", () => {
    const row = findAgentByEmail(db, "alice@example.com");
    expect(row).toEqual({
      id: "8de9b6aa-5781-4000-8000-000000000001",
      email: "alice@example.com",
      address: "8de9b6aa-5781-4000-8000-000000000001@bounty.local",
    });
  });

  test("returns null for unknown valid-shape email", () => {
    expect(findAgentByEmail(db, "ghost@example.com")).toBeNull();
  });

  test("returns null for <uuid>@<host> input (no silent fallback)", () => {
    expect(
      findAgentByEmail(
        db,
        "8de9b6aa-5781-4000-8000-000000000001@bounty.local",
      ),
    ).toBeNull();
  });

  test("returns null for bare UUID input", () => {
    expect(
      findAgentByEmail(db, "8de9b6aa-5781-4000-8000-000000000001"),
    ).toBeNull();
  });

  test("REJECTS surrounding whitespace (no silent trim)", () => {
    // The lookup helper MUST NOT silently trim and find alice@example.com
    // when the caller actually passed " alice@example.com ".
    expect(findAgentByEmail(db, " alice@example.com")).toBeNull();
    expect(findAgentByEmail(db, "alice@example.com ")).toBeNull();
    expect(findAgentByEmail(db, " alice@example.com ")).toBeNull();
  });

  test("REJECTS malformed domain (consecutive / leading / trailing dot)", () => {
    expect(findAgentByEmail(db, "alice@.example.com")).toBeNull();
    expect(findAgentByEmail(db, "alice@example..com")).toBeNull();
    expect(findAgentByEmail(db, "alice@example.com.")).toBeNull();
  });
});

describe("formatCanonicalAddress (internal IM helper)", () => {
  test("composes <uuid>@<host> from parts", () => {
    expect(
      formatCanonicalAddress("8de9b6aa-5781-4000-8000-000000000001", "bounty.local"),
    ).toBe("8de9b6aa-5781-4000-8000-000000000001@bounty.local");
  });
});
