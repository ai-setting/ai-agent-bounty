/**
 * Mail Service - Agent Communication
 * Internal mail system for agent-to-agent communication
 */

import { v4 as uuidv4 } from 'uuid';
import { Database } from '../storage/database.js';
import nodemailer from 'nodemailer';
import Imap from 'imap';
import { simpleParser } from 'mailparser';

export interface MailAddress {
  id: string;
  agentId: string;
  address: string;
  provider: 'internal' | 'smtp';
  config?: any;
  createdAt: number;
}

export interface Message {
  id: string;
  fromAddress: string;
  toAddress: string;
  subject?: string;
  body: string;
  status: 'pending' | 'sent' | 'read';
  readAt?: number;
  createdAt: number;
}

export interface SendMessageInput {
  fromAddress: string;
  toAddress: string;
  subject?: string;
  body: string;
}

export interface MailConfig {
  smtp?: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };
  imap?: {
    host: string;
    port: number;
    tls: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };
}

export class MailService {
  private db: Database;
  private config: MailConfig;
  private transporter?: nodemailer.Transporter;
  private imap?: Imap;
  private domain: string;

  constructor(db: Database, config: MailConfig = {}, domain = 'agent-mail.local') {
    this.db = db;
    this.config = config;
    this.domain = domain;
    
    if (config.smtp) {
      this.transporter = nodemailer.createTransport(config.smtp);
    }
  }

  /**
   * Generate internal mail address for an agent
   */
  generateAddress(agentId: string, agentName: string): string {
    // Generate a unique address based on agent name and id
    const sanitizedName = agentName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const shortId = agentId.substring(0, 8);
    return `${sanitizedName}-${shortId}@${this.domain}`;
  }

  /**
   * Register mail address for an agent
   */
  registerAddress(agentId: string, agentName: string, customAddress?: string): MailAddress {
    const now = Date.now();
    const id = uuidv4();
    const address = customAddress || this.generateAddress(agentId, agentName);

    // Check if address already exists
    const existing = this.db.prepare('SELECT id FROM mail_addresses WHERE address = ?').get(address);
    if (existing) {
      throw new Error(`Mail address ${address} already exists`);
    }

    this.db.prepare(`
      INSERT INTO mail_addresses (id, agent_id, address, provider, created_at)
      VALUES (?, ?, ?, 'internal', ?)
    `).run(id, agentId, address, now);

    return this.getAddressByAgent(agentId)!;
  }

  /**
   * Get mail address by agent ID
   */
  getAddressByAgent(agentId: string): MailAddress | null {
    const row = this.db.prepare('SELECT * FROM mail_addresses WHERE agent_id = ?').get(agentId) as any;
    return row ? this.mapRow(row) : null;
  }

  /**
   * Get mail address by address string
   */
  getAddressByEmail(address: string): MailAddress | null {
    const row = this.db.prepare('SELECT * FROM mail_addresses WHERE address = ?').get(address) as any;
    return row ? this.mapRow(row) : null;
  }

  /**
   * List all mail addresses
   */
  listAddresses(): MailAddress[] {
    const rows = this.db.prepare('SELECT * FROM mail_addresses ORDER BY created_at DESC').all() as any[];
    return rows.map(row => this.mapRow(row));
  }

  /**
   * Send internal message
   */
  send(input: SendMessageInput): Message {
    const now = Date.now();
    const id = uuidv4();

    // Verify sender address exists
    const fromAddress = this.getAddressByEmail(input.fromAddress);
    if (!fromAddress) {
      throw new Error(`Sender address ${input.fromAddress} not found`);
    }

    // Verify recipient address exists
    const toAddress = this.getAddressByEmail(input.toAddress);
    if (!toAddress) {
      throw new Error(`Recipient address ${input.toAddress} not found`);
    }

    this.db.prepare(`
      INSERT INTO messages (id, from_address, to_address, subject, body, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'sent', ?)
    `).run(id, input.fromAddress, input.toAddress, input.subject || '', input.body, now);

    return this.getMessage(id)!;
  }

  /**
   * Get message by ID
   */
  getMessage(id: string): Message | null {
    const row = this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as any;
    return row ? this.mapRow(row) : null;
  }

  /**
   * Get messages for an address
   */
  getMessages(address: string, options?: { unreadOnly?: boolean; limit?: number }): Message[] {
    let query = 'SELECT * FROM messages WHERE to_address = ?';
    const params: any[] = [address];

    if (options?.unreadOnly) {
      query += ' AND status != ?';
      params.push('read');
    }

    query += ' ORDER BY created_at DESC';

    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(row => this.mapRow(row));
  }

  /**
   * Get unread message count
   */
  getUnreadCount(address: string): number {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM messages 
      WHERE to_address = ? AND status != 'read'
    `).get(address) as any;
    return result?.count || 0;
  }

  /**
   * Mark message as read
   */
  markAsRead(messageId: string): boolean {
    const result = this.db.prepare(`
      UPDATE messages SET status = 'read', read_at = ? WHERE id = ?
    `).run(Date.now(), messageId);
    return result.changes > 0;
  }

  /**
   * Send via external SMTP (if configured)
   */
  async sendExternal(input: SendMessageInput): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.transporter) {
      return { success: false, error: 'SMTP not configured' };
    }

    try {
      const info = await this.transporter.sendMail({
        from: input.fromAddress,
        to: input.toAddress,
        subject: input.subject || '',
        text: input.body,
      });

      // Store in database
      const id = uuidv4();
      this.db.prepare(`
        INSERT INTO messages (id, from_address, to_address, subject, body, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'sent', ?)
      `).run(id, input.fromAddress, input.toAddress, input.subject || '', input.body, Date.now());

      return { success: true, messageId: info.messageId };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Fetch from external IMAP (if configured)
   */
  async fetchExternal(): Promise<Message[]> {
    if (!this.config.imap) {
      return [];
    }

    return new Promise((resolve, reject) => {
      const imap = new Imap(this.config.imap!);
      const messages: Message[] = [];

      const openInbox = (cb: (err: any, box: any) => void) => {
        imap.openBox('INBOX', true, cb);
      };

      imap.once('ready', () => {
        openInbox((err, box) => {
          if (err) {
            imap.end();
            reject(err);
            return;
          }

          const fetch = imap.fetch(box.messages.total + ':*', {
            bodies: 'HEADER.FIELDS (FROM TO SUBJECT)',
            struct: true,
          });

          fetch.on('message', (msg) => {
            msg.on('body', (stream) => {
              simpleParser(stream).then((parsed) => {
                // Store in database
                const id = uuidv4();
                this.db.prepare(`
                  INSERT INTO messages (id, from_address, to_address, subject, body, status, created_at)
                  VALUES (?, ?, ?, ?, ?, 'pending', ?)
                `).run(
                  id,
                  parsed.from?.value?.[0] || '',
                  parsed.to?.value?.[0] || '',
                  parsed.subject || '',
                  parsed.text || '',
                  Date.now()
                );

                messages.push({
                  id,
                  fromAddress: parsed.from?.value?.[0] || '',
                  toAddress: parsed.to?.value?.[0] || '',
                  subject: parsed.subject,
                  body: parsed.text || '',
                  status: 'pending',
                  createdAt: Date.now(),
                });
              });
            });
          });

          fetch.once('error', (err) => {
            imap.end();
            reject(err);
          });

          fetch.once('end', () => {
            imap.end();
            resolve(messages);
          });
        });
      });

      imap.once('error', (err) => {
        reject(err);
      });

      imap.connect();
    });
  }

  private mapRow(row: any): any {
    if (row.from_address !== undefined) {
      // Message row
      return {
        id: row.id,
        fromAddress: row.from_address,
        toAddress: row.to_address,
        subject: row.subject,
        body: row.body,
        status: row.status,
        readAt: row.read_at,
        createdAt: row.created_at,
      };
    } else {
      // Mail address row
      return {
        id: row.id,
        agentId: row.agent_id,
        address: row.address,
        provider: row.provider,
        config: row.config ? JSON.parse(row.config) : undefined,
        createdAt: row.created_at,
      };
    }
  }
}
