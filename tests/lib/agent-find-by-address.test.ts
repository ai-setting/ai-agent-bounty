/**
 * Tests for AgentService.findByAddress (v0.7)
 *
 * TDD RED — Tests describe the expected behavior before implementation.
 */

import { describe, test, expect } from 'bun:test';
import { Database } from '../../src/lib/storage/database.js';
import { AgentService } from '../../src/lib/agent/index.js';

describe('AgentService.findByAddress', () => {
  function makeDb(): Database {
    const db = new Database({ memory: true });
    const now = Date.now();
    db.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
                VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
      'uuid-a', 'Alice', 'alice@example.com', 'uuid-a@bounty.local', now, now
    );
    db.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
                VALUES (?, ?, ?, 'active', ?, 500, ?, ?)`).run(
      'uuid-b', 'Bob', 'bob@example.com', 'uuid-b@bounty.local', now, now
    );
    return db;
  }

  test('完整地址返回 Agent', () => {
    const db = makeDb();
    const svc = new AgentService(db);
    const agent = svc.findByAddress('uuid-a@bounty.local');
    expect(agent?.id).toBe('uuid-a');
    expect(agent?.email).toBe('alice@example.com');
    expect(agent?.address).toBe('uuid-a@bounty.local');
  });

  test('bare UUID 返回 Agent', () => {
    const db = makeDb();
    const svc = new AgentService(db);
    const agent = svc.findByAddress('uuid-b');
    expect(agent?.id).toBe('uuid-b');
    expect(agent?.email).toBe('bob@example.com');
  });

  test('找不到返回 null', () => {
    const db = makeDb();
    const svc = new AgentService(db);
    expect(svc.findByAddress('nope@bounty.local')).toBeNull();
    expect(svc.findByAddress('nope')).toBeNull();
    expect(svc.findByAddress('')).toBeNull();
  });

  test('host 不匹配返回 null (严格 address 匹配)', () => {
    const db = makeDb();
    const svc = new AgentService(db);
    expect(svc.findByAddress('uuid-a@other.local')).toBeNull();
  });

  test('null/undefined 输入返回 null', () => {
    const db = makeDb();
    const svc = new AgentService(db);
    expect(svc.findByAddress(null as any)).toBeNull();
    expect(svc.findByAddress(undefined as any)).toBeNull();
  });
});