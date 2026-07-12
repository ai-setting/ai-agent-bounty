/**
 * Tests for src/server/lib/address-resolver.ts (v0.10 strict)
 *
 * v0.10 BREAKING:
 * - `parseAgentAddress` REJECTS bare UUID input (was: returned with host=undefined)
 * - `findAgentByAddress` requires exact `<uuid>@<host>` (no bare-UUID fallback)
 */

import { describe, test, expect } from 'bun:test';
import { parseAgentAddress, findAgentByAddress } from '../../src/server/lib/address-resolver.js';
import { Database } from '../../src/lib/storage/database.js';

describe('parseAgentAddress (v0.10 strict)', () => {
  test('标准格式 uuid@host 正确解析', () => {
    const r = parseAgentAddress('8de9b6aa-5781-4a65-be96-45185fb7c8b1@bounty.tongagents.example.com');
    expect(r).toEqual({
      uuid: '8de9b6aa-5781-4a65-be96-45185fb7c8b1',
      host: 'bounty.tongagents.example.com',
      raw: '8de9b6aa-5781-4a65-be96-45185fb7c8b1@bounty.tongagents.example.com',
    });
  });

  test('v0.10 BREAKING: 纯 UUID 拒绝 — 返回 null (was: 返回 with host=undefined)', () => {
    const r = parseAgentAddress('8de9b6aa-5781-4a65-be96-45185fb7c8b1');
    expect(r).toBeNull();
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

  test('@ 后为空 host → null', () => {
    expect(parseAgentAddress('8de9b6aa-5781-4a65-be96-45185fb7c8b1@')).toBeNull();
  });

  test('uuid 前为空 (即 @host) → null', () => {
    expect(parseAgentAddress('@host.com')).toBeNull();
  });

  test('trim 空白后空串 → null', () => {
    expect(parseAgentAddress('   ')).toBeNull();
  });

  test('多 @ 字符 REJECTED — 返回 null (BREAKING, was: 切分到第一个@)', () => {
    expect(parseAgentAddress('uuid@host1@host2')).toBeNull();
  });

  test('trim 空白前缀后解析', () => {
    const r = parseAgentAddress('  8de9b6aa-5781-4a65-be96-45185fb7c8b1@host.com  ');
    expect(r?.uuid).toBe('8de9b6aa-5781-4a65-be96-45185fb7c8b1');
    expect(r?.host).toBe('host.com');
  });
});

describe('findAgentByAddress (v0.10 strict)', () => {
  function makeDb(): Database {
    const db = new Database({ memory: true });
    const now = Date.now();
    db.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
                VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
      '8de9b6aa-5781-4a65-be96-45185fb7c8b1', 'Alice', 'alice@example.com',
      '8de9b6aa-5781-4a65-be96-45185fb7c8b1@bounty.local', now, now
    );
    db.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
                VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
      'ee0dd085-0b66-4640-81bc-f8d4c743c1e6', 'Bob', 'bob@example.com',
      'ee0dd085-0b66-4640-81bc-f8d4c743c1e6@bounty.local', now, now
    );
    return db;
  }

  test('完整地址精确匹配', () => {
    const db = makeDb();
    const r = findAgentByAddress(db, '8de9b6aa-5781-4a65-be96-45185fb7c8b1@bounty.local');
    expect(r).not.toBeNull();
    expect(r?.id).toBe('8de9b6aa-5781-4a65-be96-45185fb7c8b1');
    expect(r?.email).toBe('alice@example.com');
    expect(r?.address).toBe('8de9b6aa-5781-4a65-be96-45185fb7c8b1@bounty.local');
  });

  test('v0.10 BREAKING: 纯 UUID 拒绝 — 返回 null (was: 命中)', () => {
    const db = makeDb();
    const r = findAgentByAddress(db, 'ee0dd085-0b66-4640-81bc-f8d4c743c1e6');
    expect(r).toBeNull();
  });

  test('找不到返回 null', () => {
    const db = makeDb();
    expect(findAgentByAddress(db, '00000000-0000-4000-8000-000000000000@bounty.local')).toBeNull();
  });

  test('空输入返回 null (不抛)', () => {
    const db = makeDb();
    expect(findAgentByAddress(db, '')).toBeNull();
    expect(findAgentByAddress(db, null as any)).toBeNull();
    expect(findAgentByAddress(db, undefined as any)).toBeNull();
  });

  test('host 不匹配时不返回 (address 精确匹配)', () => {
    const db = makeDb();
    expect(findAgentByAddress(db, '8de9b6aa-5781-4a65-be96-45185fb7c8b1@other.local')).toBeNull();
  });

  test('非字符串输入返回 null', () => {
    const db = makeDb();
    expect(findAgentByAddress(db, 123 as any)).toBeNull();
    expect(findAgentByAddress(db, {} as any)).toBeNull();
  });
});
