/**
 * Tests for AgentService.findByAddress (v0.10 strict)
 *
 * v0.10 BREAKING: bare UUID fallback REMOVED. Only exact `<uuid>@<host>`
 * matches are accepted.
 */

import { describe, test, expect } from 'bun:test';
import { Database } from '../../src/lib/storage/database.js';
import { AgentService } from '../../src/lib/agent/index.js';

describe('AgentService.findByAddress (v0.10 strict)', () => {
  function makeDb(): Database {
    const db = new Database({ memory: true });
    const now = Date.now();
    db.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
                VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
      '8de9b6aa-5781-4a65-be96-45185fb7c8b1', 'Alice', 'alice@example.com',
      '8de9b6aa-5781-4a65-be96-45185fb7c8b1@bounty.local', now, now
    );
    db.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
                VALUES (?, ?, ?, 'active', ?, 500, ?, ?)`).run(
      'ee0dd085-0b66-4640-81bc-f8d4c743c1e6', 'Bob', 'bob@example.com',
      'ee0dd085-0b66-4640-81bc-f8d4c743c1e6@bounty.local', now, now
    );
    return db;
  }

  test('完整地址返回 Agent', () => {
    const db = makeDb();
    const svc = new AgentService(db);
    const agent = svc.findByAddress('8de9b6aa-5781-4a65-be96-45185fb7c8b1@bounty.local');
    expect(agent?.id).toBe('8de9b6aa-5781-4a65-be96-45185fb7c8b1');
    expect(agent?.email).toBe('alice@example.com');
    expect(agent?.address).toBe('8de9b6aa-5781-4a65-be96-45185fb7c8b1@bounty.local');
  });

  test('v0.10 BREAKING: bare UUID 拒绝 — 返回 null', () => {
    const db = makeDb();
    const svc = new AgentService(db);
    const agent = svc.findByAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6');
    expect(agent).toBeNull();
  });

  test('找不到返回 null', () => {
    const db = makeDb();
    const svc = new AgentService(db);
    expect(svc.findByAddress('00000000-0000-4000-8000-000000000000@nope.local')).toBeNull();
    expect(svc.findByAddress('')).toBeNull();
  });

  test('host 不匹配返回 null (严格 address 匹配)', () => {
    const db = makeDb();
    const svc = new AgentService(db);
    expect(svc.findByAddress('8de9b6aa-5781-4a65-be96-45185fb7c8b1@other.local')).toBeNull();
  });

  test('null/undefined 输入返回 null', () => {
    const db = makeDb();
    const svc = new AgentService(db);
    expect(svc.findByAddress(null as any)).toBeNull();
    expect(svc.findByAddress(undefined as any)).toBeNull();
  });
});
