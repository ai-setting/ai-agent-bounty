/**
 * Tests for src/server/lib/address-resolver.ts
 * Phase: feat/bounty-task-optimize v0.7 (address-based API)
 *
 * TDD RED — These tests describe the expected behavior before implementation.
 */

import { describe, test, expect } from 'bun:test';
import { parseAgentAddress, findAgentByAddress } from '../../src/server/lib/address-resolver.js';
import { Database } from '../../src/lib/storage/database.js';

describe('parseAgentAddress', () => {
  test('标准格式 uuid@host 正确解析', () => {
    const r = parseAgentAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6@bounty.tongagents.example.com');
    expect(r).toEqual({
      uuid: 'ee0dd085-0b66-4640-81bc-f8d4c743c1e6',
      host: 'bounty.tongagents.example.com',
      raw: 'ee0dd085-0b66-4640-81bc-f8d4c743c1e6@bounty.tongagents.example.com',
    });
  });

  test('纯 UUID (无 @host) 兼容', () => {
    const r = parseAgentAddress('ee0dd085-0b66-4640-81bc-f8d4c743c1e6');
    expect(r).toEqual({
      uuid: 'ee0dd085-0b66-4640-81bc-f8d4c743c1e6',
      host: undefined,
      raw: 'ee0dd085-0b66-4640-81bc-f8d4c743c1e6',
    });
  });

  test('空串返回 null', () => {
    expect(parseAgentAddress('')).toBeNull();
  });

  test('null/undefined 返回 null', () => {
    expect(parseAgentAddress(null as any)).toBeNull();
    expect(parseAgentAddress(undefined as any)).toBeNull();
  });

  test('非字符串返回 null', () => {
    expect(parseAgentAddress(123 as any)).toBeNull();
    expect(parseAgentAddress({} as any)).toBeNull();
    expect(parseAgentAddress([] as any)).toBeNull();
  });

  test('@ 后为空 host → null (uuid 为空不合法)', () => {
    expect(parseAgentAddress('@bounty.example.com')).toBeNull();
  });

  test('uuid 前为空 (即 @host) → null', () => {
    expect(parseAgentAddress('@host.com')).toBeNull();
  });

  test('trim 空白后空串 → null', () => {
    expect(parseAgentAddress('   ')).toBeNull();
  });

  test('多 @ 字符以第一个切分', () => {
    const r = parseAgentAddress('uuid@host1@host2');
    expect(r?.uuid).toBe('uuid');
    expect(r?.host).toBe('host1@host2');
    expect(r?.raw).toBe('uuid@host1@host2');
  });

  test('trim 空白前缀后解析', () => {
    const r = parseAgentAddress('  uuid@host.com  ');
    expect(r?.uuid).toBe('uuid');
    expect(r?.host).toBe('host.com');
  });
});

describe('findAgentByAddress', () => {
  function makeDb(): Database {
    const db = new Database({ memory: true });
    const now = Date.now();
    db.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
                VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
      'uuid-1', 'Alice', 'alice@example.com', 'uuid-1@bounty.local', now, now
    );
    db.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
                VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
      'uuid-2', 'Bob', 'bob@example.com', 'uuid-2@bounty.local', now, now
    );
    return db;
  }

  test('完整地址精确匹配', () => {
    const db = makeDb();
    const r = findAgentByAddress(db, 'uuid-1@bounty.local');
    expect(r).toEqual({ id: 'uuid-1', email: 'alice@example.com' });
  });

  test('纯 UUID 也兼容', () => {
    const db = makeDb();
    const r = findAgentByAddress(db, 'uuid-2');
    expect(r).toEqual({ id: 'uuid-2', email: 'bob@example.com' });
  });

  test('找不到返回 null', () => {
    const db = makeDb();
    expect(findAgentByAddress(db, 'nonexistent@bounty.local')).toBeNull();
    expect(findAgentByAddress(db, 'nonexistent')).toBeNull();
  });

  test('空输入返回 null (不抛)', () => {
    const db = makeDb();
    expect(findAgentByAddress(db, '')).toBeNull();
    expect(findAgentByAddress(db, null as any)).toBeNull();
    expect(findAgentByAddress(db, undefined as any)).toBeNull();
  });

  test('host 不匹配时不返回 (address 精确匹配)', () => {
    const db = makeDb();
    expect(findAgentByAddress(db, 'uuid-1@other.local')).toBeNull();
  });

  test('非字符串输入返回 null', () => {
    const db = makeDb();
    expect(findAgentByAddress(db, 123 as any)).toBeNull();
    expect(findAgentByAddress(db, {} as any)).toBeNull();
  });
});