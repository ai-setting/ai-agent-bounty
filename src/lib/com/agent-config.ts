/**
 * Agent Configuration Service
 * Manages SMTP/IMAP configuration per agent
 */

import { randomUUID } from "crypto";
import { Database } from "../storage/database.js";

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
   */
  saveConfig(config: AgentConfig): void {
    const now = Date.now();
    
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
        config.smtpPassword || null,
        config.smtpSecure ? 1 : 0,
        config.imapHost || null,
        config.imapPort,
        config.imapUser || null,
        config.imapPassword || null,
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
        config.smtpPassword || null,
        config.smtpSecure ? 1 : 0,
        config.imapHost || null,
        config.imapPort,
        config.imapUser || null,
        config.imapPassword || null,
        config.imapTls ? 1 : 0,
        now,
        now
      );
    }
  }

  /**
   * Get agent configuration
   */
  getConfig(agentId: string): AgentConfig | null {
    const row = this.db.prepare(
      'SELECT * FROM agent_configs WHERE agent_id = ?'
    ).get(agentId) as any;
    
    if (!row) return null;
    
    return {
      agentId: row.agent_id,
      smtpHost: row.smtp_host,
      smtpPort: row.smtp_port,
      smtpUser: row.smtp_user,
      smtpPassword: row.smtp_password,
      smtpSecure: row.smtp_secure === 1,
      imapHost: row.imap_host,
      imapPort: row.imap_port,
      imapUser: row.imap_user,
      imapPassword: row.imap_password,
      imapTls: row.imap_tls === 1,
    };
  }

  /**
   * Delete agent configuration
   */
  deleteConfig(agentId: string): boolean {
    const result = this.db.prepare(
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
