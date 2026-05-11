/**
 * @fileoverview BountyMailService - 统一的邮件服务
 * 
 * 整合内部邮件和外部 SMTP/IMAP，提供统一的邮件发送和接收接口
 */

import { Database } from '../storage/database.js';
import { AgentService } from '../agent/index.js';
import { MailQueue, type MailSender } from './queue.js';

/**
 * SMTP 配置
 */
export interface SmtpConfig {
  host: string;
  port?: number;
  secure?: boolean;
  user: string;
  password: string;
}

/**
 * IDLE 状态
 */
export interface IdleState {
  mailbox: string;
  lastUid: number;
  checkedAt: number;
}

/**
 * BountyMailService 配置
 */
export interface BountyMailServiceConfig {
  db: Database;
  agentService: AgentService;
}

/**
 * Send result
 */
export interface SendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Queue result
 */
export interface QueueResult {
  queued: boolean;
  queueId?: string;
  error?: string;
}

/**
 * 邮件地址
 */
export interface MailAddress {
  id: string;
  agentId: string;
  address: string;
  provider: string;
  createdAt: number;
}

/**
 * BountyMailService - 统一的邮件服务
 * 
 * 特性：
 * - 内部邮件（SQLite）
 * - 外部 SMTP 发送
 * - 消息队列（重试）
 * - IDLE 状态持久化
 */
export class BountyMailService {
  private db: Database;
  private agentService: AgentService;
  private queue: MailQueue;

  constructor(config: BountyMailServiceConfig) {
    this.db = config.db;
    this.agentService = config.agentService;
    this.queue = new MailQueue({
      send: async () => ({ success: true }),
    });
  }

  /**
   * 初始化
   */
  async init(): Promise<void> {
    // 恢复队列状态
    const messages = this.loadQueueMessages();
    if (messages.length > 0) {
      this.queue.restore(messages);
    }

    // 设置持久化回调
    this.queue.setPersistCallback((messages) => {
      this.saveQueueMessages(messages);
    });
  }

  // ==========================================================================
  // Address Management
  // ==========================================================================

  /**
   * 注册 Agent 邮箱地址
   */
  async registerAgentMailAddress(agentId: string, name: string): Promise<MailAddress> {
    const address = this.generateAddress(agentId, name);
    
    this.db.prepare(`
      INSERT OR IGNORE INTO mail_addresses (id, agent_id, address, provider, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      this.generateId(),
      agentId,
      address,
      'internal',
      Date.now()
    );

    return {
      id: this.generateId(),
      agentId,
      address,
      provider: 'internal',
      createdAt: Date.now(),
    };
  }

  /**
   * 获取 Agent 邮箱地址
   */
  async getAgentMailAddress(agentId: string): Promise<MailAddress | null> {
    const row = this.db.prepare(`
      SELECT * FROM mail_addresses WHERE agent_id = ? AND provider = 'internal'
    `).get(agentId) as any;

    if (!row) return null;

    return {
      id: row.id,
      agentId: row.agent_id,
      address: row.address,
      provider: row.provider,
      createdAt: row.created_at,
    };
  }

  /**
   * 列出所有邮箱地址
   */
  async listAddresses(): Promise<MailAddress[]> {
    const rows = this.db.prepare(`
      SELECT * FROM mail_addresses WHERE provider = 'internal'
    `).all() as any[];

    return rows.map(row => ({
      id: row.id,
      agentId: row.agent_id,
      address: row.address,
      provider: row.provider,
      createdAt: row.created_at,
    }));
  }

  // ==========================================================================
  // Send
  // ==========================================================================

  /**
   * 发送消息（自动路由）
   */
  async send(params: {
    from: string;
    to: string;
    subject: string;
    body: string;
  }): Promise<SendResult> {
    if (this.isInternalAddress(params.to)) {
      return this.sendInternal(params);
    } else {
      return this.sendExternalViaQueue(params);
    }
  }

  /**
   * 发送内部消息
   */
  private async sendInternal(params: {
    from: string;
    to: string;
    subject: string;
    body: string;
  }): Promise<SendResult> {
    // 验证地址存在
    const fromAddr = this.db.prepare(`
      SELECT * FROM mail_addresses WHERE address = ?
    `).get(params.from) as any;

    const toAddr = this.db.prepare(`
      SELECT * FROM mail_addresses WHERE address = ?
    `).get(params.to) as any;

    if (!fromAddr || !toAddr) {
      return { success: false, error: 'Invalid address' };
    }

    // 存储消息
    const messageId = this.generateId();
    this.db.prepare(`
      INSERT INTO messages (id, from_address, to_address, subject, body, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      messageId,
      params.from,
      params.to,
      params.subject,
      params.body,
      'sent',
      Date.now()
    );

    return { success: true, messageId };
  }

  /**
   * 发送外部消息（通过 SMTP 队列）
   */
  private async sendExternalViaQueue(params: {
    from: string;
    to: string;
    subject: string;
    body: string;
  }): Promise<SendResult> {
    // 从 from 地址获取 agent
    const fromAddr = this.db.prepare(`
      SELECT * FROM mail_addresses WHERE address = ?
    `).get(params.from) as any;

    if (!fromAddr) {
      return { success: false, error: 'Unknown sender' };
    }

    // 获取 SMTP 配置
    const smtpConfig = this.getSmtpConfig(fromAddr.agent_id);
    if (!smtpConfig) {
      return { success: false, error: 'SMTP not configured' };
    }

    // 加入队列
    const queueId = this.queue.enqueue({
      from: params.from,
      to: params.to,
      subject: params.subject,
      body: params.body,
      maxRetries: 3,
    });

    return { success: true, messageId: queueId };
  }

  /**
   * 发送外部消息（直接排队，返回队列结果）
   */
  async sendExternal(params: {
    from: string;
    to: string;
    subject: string;
    body: string;
  }, agentId: string): Promise<QueueResult> {
    // 验证 SMTP 配置
    const smtpConfig = this.getSmtpConfig(agentId);
    if (!smtpConfig) {
      return { queued: false, error: 'SMTP not configured for agent' };
    }

    const queueId = this.queue.enqueue({
      from: params.from,
      to: params.to,
      subject: params.subject,
      body: params.body,
      maxRetries: 3,
    });

    return { queued: true, queueId };
  }

  // ==========================================================================
  // Receive
  // ==========================================================================

  /**
   * 获取消息
   */
  async getMessages(address: string, options?: {
    limit?: number;
    unreadOnly?: boolean;
  }): Promise<any[]> {
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

    return rows.map(row => ({
      id: row.id,
      from: row.from_address,
      to: row.to_address,
      subject: row.subject,
      body: row.body,
      status: row.status,
      readAt: row.read_at,
      createdAt: row.created_at,
    }));
  }

  // ==========================================================================
  // Queue
  // ==========================================================================

  /**
   * 设置 SMTP 发送器
   */
  setSmtpSender(sender: MailSender): void {
    this.queue = new MailQueue(sender);
    this.queue.setPersistCallback((messages) => {
      this.saveQueueMessages(messages);
    });
  }

  /**
   * 获取队列
   */
  getQueue(): MailQueue {
    return this.queue;
  }

  /**
   * 获取队列统计
   */
  getQueueStats() {
    return this.queue.getStats();
  }

  // ==========================================================================
  // SMTP Config
  // ==========================================================================

  /**
   * 配置 Agent SMTP
   */
  async configureAgentSMTP(agentId: string, config: SmtpConfig): Promise<void> {
    // 检查是否已存在
    const existing = this.db.prepare(`
      SELECT id FROM agent_configs WHERE agent_id = ?
    `).get(agentId) as any;

    if (existing) {
      // 更新
      this.db.prepare(`
        UPDATE agent_configs SET
          smtp_host = ?, smtp_port = ?, smtp_user = ?, 
          smtp_password = ?, smtp_secure = ?, updated_at = ?
        WHERE agent_id = ?
      `).run(
        config.host,
        config.port || 587,
        config.user,
        config.password,
        config.secure ? 1 : 0,
        Date.now(),
        agentId
      );
    } else {
      // 插入
      this.db.prepare(`
        INSERT INTO agent_configs 
        (id, agent_id, smtp_host, smtp_port, smtp_user, smtp_password, smtp_secure, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        this.generateId(),
        agentId,
        config.host,
        config.port || 587,
        config.user,
        config.password,
        config.secure ? 1 : 0,
        Date.now(),
        Date.now()
      );
    }
  }

  /**
   * 获取 SMTP 配置
   */
  getSmtpConfig(agentId: string): SmtpConfig | null {
    const row = this.db.prepare(`
      SELECT * FROM agent_configs WHERE agent_id = ?
    `).get(agentId) as any;

    if (!row || !row.smtp_host) return null;

    return {
      host: row.smtp_host,
      port: row.smtp_port,
      secure: row.smtp_secure === 1,
      user: row.smtp_user,
      password: row.smtp_password,
    };
  }

  // ==========================================================================
  // IDLE State
  // ==========================================================================

  /**
   * 保存 IDLE 状态
   */
  async saveIdleState(agentId: string, mailbox: string, lastUid: number): Promise<void> {
    this.db.prepare(`
      INSERT OR REPLACE INTO mail_channels (id, agent_id, address, status, last_checked_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      this.generateId(),
      agentId,
      mailbox,
      'connected',
      lastUid,
      Date.now()
    );
  }

  /**
   * 获取 IDLE 状态
   */
  async getIdleState(agentId: string): Promise<IdleState | null> {
    const row = this.db.prepare(`
      SELECT * FROM mail_channels WHERE agent_id = ?
    `).get(agentId) as any;

    if (!row) return null;

    return {
      mailbox: row.address,
      lastUid: row.last_checked_at,
      checkedAt: row.last_checked_at,
    };
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  /**
   * 判断是否为内部地址
   */
  isInternalAddress(address: string): boolean {
    return address.endsWith('@agent-mail.local');
  }

  /**
   * 生成地址
   */
  private generateAddress(agentId: string, name: string): string {
    const shortId = agentId.substring(0, 8).toLowerCase();
    const safeName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `${safeName}-${shortId}@agent-mail.local`;
  }

  /**
   * 生成 ID
   */
  private generateId(): string {
    return `id_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * 加载队列消息
   */
  private loadQueueMessages(): any[] {
    // TODO: 从数据库加载
    return [];
  }

  /**
   * 保存队列消息
   */
  private saveQueueMessages(messages: any[]): void {
    // TODO: 保存到数据库
  }
}
