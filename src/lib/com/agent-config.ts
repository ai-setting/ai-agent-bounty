/**
 * Agent Configuration Service
 * Manages SMTP/IMAP configuration per agent
 * Passwords are encrypted before storage
 */

import { randomUUID } from "crypto";
import { Database } from "../storage/database.js";
import { encrypt, decrypt } from "../utils/crypto.js";

export interface AgentConfig {
  agentId: string;
  smtpHost?: string;
  smtpPort: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpSecure: boolean;
  imapHost?: string;
  imapPort: number;
  imapUser?: string;
  imapPassword?: string;
  imapTls: boolean;
}

export class AgentConfigService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Save or update agent configuration
   * Passwords are encrypted before storage
   */
  saveConfig(config: AgentConfig): void {
    const now = Date.now();
    
    // Encrypt passwords before storage
    const encryptedSmtpPassword = config.smtpPassword ? encrypt(config.smtpPassword) : null;
    const encryptedImapPassword = config.imapPassword ? encrypt(config.imapPassword) : null;
    
    // Check if config exists
    const existing = this.db.prepare(
      'SELECT id FROM agent_configs WHERE agent_id = ?'
    ).get(config.agentId);

    if (existing) {
      // Update existing
      this.db.prepare(`
        UPDATE agent_configs SET
          smtp_host = ?,
          smtp_port = ?,
          smtp_user = ?,
          smtp_password = ?,
          smtp_secure = ?,
          imap_host = ?,
          imap_port = ?,
          imap_user = ?,
          imap_password = ?,
          imap_tls = ?,
          updated_at = ?
        WHERE agent_id = ?
      `).run(
        config.smtpHost || null,
        config.smtpPort,
        config.smtpUser || null,
        encryptedSmtpPassword,
        config.smtpSecure ? 1 : 0,
        config.imapHost || null,
        config.imapPort,
        config.imapUser || null,
        encryptedImapPassword,
        config.imapTls ? 1 : 0,
        now,
        config.agentId
      );
    } else {
      // Insert new
      this.db.prepare(`
        INSERT INTO agent_configs (
          id, agent_id, smtp_host, smtp_port, smtp_user, smtp_password, smtp_secure,
          imap_host, imap_port, imap_user, imap_password, imap_tls, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        config.agentId,
        config.smtpHost || null,
        config.smtpPort,
        config.smtpUser || null,
        encryptedSmtpPassword,
        config.smtpSecure ? 1 : 0,
        config.imapHost || null,
        config.imapPort,
        config.imapUser || null,
        encryptedImapPassword,
        config.imapTls ? 1 : 0,
        now,
        now
      );
    }
  }

  /**
   * Get agent configuration
   * Passwords are decrypted when retrieved
   */
  getConfig(agentId: string): AgentConfig | null {
    const row = this.db.prepare(
      'SELECT * FROM agent_configs WHERE agent_id = ?'
    ).get(agentId) as any;
    
    if (!row) return null;
    
    // Decrypt passwords when retrieving
    let decryptedSmtpPassword: string | undefined;
    let decryptedImapPassword: string | undefined;
    
    try {
      decryptedSmtpPassword = row.smtp_password ? decrypt(row.smtp_password) : undefined;
    } catch (e) {
      console.warn('[AgentConfig] Failed to decrypt SMTP password');
    }
    
    try {
      decryptedImapPassword = row.imap_password ? decrypt(row.imap_password) : undefined;
    } catch (e) {
      console.warn('[AgentConfig] Failed to decrypt IMAP password');
    }
    
    return {
      agentId: row.agent_id,
      smtpHost: row.smtp_host,
      smtpPort: row.smtp_port,
      smtpUser: row.smtp_user,
      smtpPassword: decryptedSmtpPassword,
      smtpSecure: row.smtp_secure === 1,
      imapHost: row.imap_host,
      imapPort: row.imap_port,
      imapUser: row.imap_user,
      imapPassword: decryptedImapPassword,
      imapTls: row.imap_tls === 1,
    };
  }

  /**
   * Delete agent configuration
   */
  deleteConfig(agentId: string): boolean {
    this.db.prepare(
      'DELETE FROM agent_configs WHERE agent_id = ?'
    ).run(agentId);
    return true;
  }

  /**
   * Check if agent has SMTP configured
   */
  hasSmtpConfig(agentId: string): boolean {
    const config = this.getConfig(agentId);
    return !!(config?.smtpHost && config?.smtpUser && config?.smtpPassword);
  }

  /**
   * Check if agent has IMAP configured
   */
  hasImapConfig(agentId: string): boolean {
    const config = this.getConfig(agentId);
    return !!(config?.imapHost && config?.imapUser && config?.imapPassword);
  }
}
