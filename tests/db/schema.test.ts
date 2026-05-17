import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from '../../src/lib/storage/database';

describe('Database Schema Migrations', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database({ memory: true });
  });

  describe('Agents table schema', () => {
    it('should have status column with default "pending"', () => {
      const result = db.prepare(`
        SELECT sql FROM sqlite_master WHERE type='table' AND name='agents'
      `).get() as { sql: string } | undefined;

      expect(result).toBeDefined();
      expect(result?.sql).toContain('status');
      expect(result?.sql).toContain("DEFAULT 'pending'");
    });

    it('should have address column on agents table', () => {
      const result = db.prepare(`
        SELECT sql FROM sqlite_master WHERE type='table' AND name='agents'
      `).get() as { sql: string } | undefined;

      expect(result).toBeDefined();
      expect(result?.sql).toContain('address');
    });
  });

  describe('Verifications table schema', () => {
    it('should create verifications table', () => {
      const result = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='verifications'
      `).get() as { name: string } | undefined;

      expect(result).toBeDefined();
      expect(result?.name).toBe('verifications');
    });

    it('should have all required columns in verifications table', () => {
      const result = db.prepare(`
        SELECT sql FROM sqlite_master WHERE type='table' AND name='verifications'
      `).get() as { sql: string } | undefined;

      expect(result).toBeDefined();
      const sql = result?.sql || '';

      expect(sql).toContain('id TEXT PRIMARY KEY');
      expect(sql).toContain('agent_id TEXT NOT NULL');
      expect(sql).toContain('email TEXT NOT NULL');
      expect(sql).toContain('code TEXT NOT NULL');
      expect(sql).toContain("type TEXT DEFAULT 'register'");
      expect(sql).toContain('expires_at INTEGER NOT NULL');
      expect(sql).toContain('verified_at INTEGER');
      expect(sql).toContain('created_at INTEGER NOT NULL');
    });
  });

  describe('Verifications table indexes', () => {
    it('should have idx_verifications_email index', () => {
      const result = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='index' AND name='idx_verifications_email'
      `).get() as { name: string } | undefined;

      expect(result).toBeDefined();
      expect(result?.name).toBe('idx_verifications_email');
    });
  });

  describe('Existing tables preservation', () => {
    it('should preserve tasks table', () => {
      const result = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'
      `).get() as { name: string } | undefined;

      expect(result).toBeDefined();
      expect(result?.name).toBe('tasks');
    });

    it('should preserve escrows table', () => {
      const result = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='escrows'
      `).get() as { name: string } | undefined;

      expect(result).toBeDefined();
      expect(result?.name).toBe('escrows');
    });

    it('should preserve credit_transactions table', () => {
      const result = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name='credit_transactions'
      `).get() as { name: string } | undefined;

      expect(result).toBeDefined();
      expect(result?.name).toBe('credit_transactions');
    });
  });
});
