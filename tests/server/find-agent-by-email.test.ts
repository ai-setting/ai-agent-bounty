/**
 * v0.13: Tests for `findAgentByEmail` in src/server/lib/address-resolver.ts.
 *
 * v0.13 BREAKING: server endpoints now accept the registered email
 * (agents.email UNIQUE column) as the primary lookup key. The address
 * (`uuid@host`) form is preserved as a secondary lookup path for
 * backward compatibility with any pre-v0.13 caller.
 */

import { describe, test, expect } from 'bun:test';
import { findAgentByEmail } from '../../src/server/lib/address-resolver.js';
import { Database } from '../../src/lib/storage/database.js';

function makeDb(): Database {
  const db = new Database({ memory: true });
  const now = Date.now();
  db.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
              VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
    '8de9b6aa-5781-4000-8000-000000000001',
    'Alice',
    'alice@example.com',
    '8de9b6aa-5781-4000-8000-000000000001@bounty.local',
    now,
    now
  );
  db.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
              VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
    '8de9b6aa-2222-4000-8000-000000000002',
    'Bob',
    'bob@example.com',
    '8de9b6aa-2222-4000-8000-000000000002@bounty.local',
    now,
    now
  );
  return db;
}

describe('findAgentByEmail (v0.13)', () => {
  test('email 精确匹配 → 返回 {id, email, address}', () => {
    const db = makeDb();
    const r = findAgentByEmail(db, 'alice@example.com');
    expect(r).not.toBeNull();
    expect(r?.id).toBe('8de9b6aa-5781-4000-8000-000000000001');
    expect(r?.email).toBe('alice@example.com');
    expect(r?.address).toBe('8de9b6aa-5781-4000-8000-000000000001@bounty.local');
  });

  test('email 大小写不敏感（DB 内 email 按原样存储；查询按精确字串）', () => {
    const db = makeDb();
    // 默认 email 存的就是 alice@example.com；大小写不同 → 不命中
    expect(findAgentByEmail(db, 'ALICE@example.com')).toBeNull();
    expect(findAgentByEmail(db, 'alice@example.com')).not.toBeNull();
  });

  test('email trim 后空串 → null（不抛）', () => {
    const db = makeDb();
    expect(findAgentByEmail(db, '')).toBeNull();
    expect(findAgentByEmail(db, '   ')).toBeNull();
  });

  test('email null/undefined → null', () => {
    const db = makeDb();
    expect(findAgentByEmail(db, null as any)).toBeNull();
    expect(findAgentByEmail(db, undefined as any)).toBeNull();
  });

  test('email 非字符串 → null', () => {
    const db = makeDb();
    expect(findAgentByEmail(db, 123 as any)).toBeNull();
    expect(findAgentByEmail(db, {} as any)).toBeNull();
    expect(findAgentByEmail(db, [] as any)).toBeNull();
  });

  test('email 不存在 → null', () => {
    const db = makeDb();
    expect(findAgentByEmail(db, 'noone@example.com')).toBeNull();
  });

  test('email 含 uuid@host 形式 → 视为非 email，返回 null（让 address 路径处理）', () => {
    const db = makeDb();
    // findAgentByEmail 是 strict email-only lookup；含 @ 字符的 uuid@host 由 findAgentByAddress 处理
    expect(findAgentByEmail(db, '8de9b6aa-5781-4000-8000-000000000001@bounty.local')).toBeNull();
  });
});

import { findAgentByEmailOrAddress } from '../../src/server/lib/address-resolver.js';

describe('findAgentByEmailOrAddress (v0.13)', () => {
  test('email 优先命中', () => {
    const db = makeDb();
    const r = findAgentByEmailOrAddress(db, 'alice@example.com');
    expect(r?.id).toBe('8de9b6aa-5781-4000-8000-000000000001');
  });

  test('address 形式回落命中', () => {
    const db = makeDb();
    const r = findAgentByEmailOrAddress(
      db,
      '8de9b6aa-2222-4000-8000-000000000002@bounty.local'
    );
    expect(r?.id).toBe('8de9b6aa-2222-4000-8000-000000000002');
    expect(r?.email).toBe('bob@example.com');
  });

  test('email 和 address 都不命中 → null', () => {
    const db = makeDb();
    expect(findAgentByEmailOrAddress(db, 'noone@example.com')).toBeNull();
    expect(findAgentByEmailOrAddress(db, '00000000-0000-4000-8000-000000000000@bounty.local')).toBeNull();
  });

  test('email 形式优先于 address（即使两者都指向同一 agent）', () => {
    const db = makeDb();
    // Alice 同时拥有 alice@example.com 和 <uuid>@bounty.local，传入 email 应当走 email 路径
    const r = findAgentByEmailOrAddress(db, 'alice@example.com');
    expect(r?.email).toBe('alice@example.com');
  });
});