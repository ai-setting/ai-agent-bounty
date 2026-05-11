/**
 * TDD: BountyMailService Tests
 * 
 * RED Phase: 编写失败的测试
 * 
 * 测试 BountyMailService 的核心功能：
 * 1. 统一发送接口
 * 2. 自动路由（内部/外部）
 * 3. 消息队列集成
 * 4. IDLE 状态持久化
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { Database } from '../src/lib/storage/database.js';
import { AgentService } from '../src/lib/agent/index.js';
import { BountyMailService, type BountyMailServiceConfig } from '../src/lib/mail/bounty-mail-service.js';
import type { MailSender } from '../src/lib/mail/queue.js';

// ============================================================================
// Test Fixtures
// ============================================================================

interface TestFixtures {
  db: Database;
  agentService: AgentService;
  mailService: BountyMailService;
}

async function createTestFixtures(): Promise<TestFixtures> {
  const db = new Database({ memory: true });
  const agentService = new AgentService(db);
  const mailService = new BountyMailService({
    db,
    agentService,
  });

  await mailService.init();

  return { db, agentService, mailService };
}

// ============================================================================
// Mock SMTP Sender
// ============================================================================

const mockSmtpSender: MailSender = {
  send: vi.fn().mockResolvedValue({ success: true, messageId: 'smtp-123' }),
};

// ============================================================================
// Tests: Initialization
// ============================================================================

describe('BountyMailService', () => {
  describe('Initialization', () => {
    it('should initialize without errors', async () => {
      const fixtures = await createTestFixtures();
      expect(fixtures.mailService).toBeDefined();
      fixtures.db.close();
    });

    it('should create internal mail address for agent', async () => {
      const { db, agentService, mailService } = await createTestFixtures();

      const agent = agentService.register({
        name: 'TestAgent',
        email: 'test@example.com',
      });

      await mailService.registerAgentMailAddress(agent.id, agent.name);

      const address = await mailService.getAgentMailAddress(agent.id);
      expect(address).toBeDefined();
      expect(address?.address).toContain('testagent');
      expect(address?.address).toContain('@agent-mail.local');

      db.close();
    });
  });

  // ============================================================================
  // Tests: Send
  // ============================================================================

  describe('Send', () => {
    it('should send internal message successfully', async () => {
      const { db, agentService, mailService } = await createTestFixtures();

      // Register two agents
      const alice = agentService.register({ name: 'Alice', email: 'alice@test.com' });
      const bob = agentService.register({ name: 'Bob', email: 'bob@test.com' });

      await mailService.registerAgentMailAddress(alice.id, alice.name);
      await mailService.registerAgentMailAddress(bob.id, bob.name);

      const aliceAddress = await mailService.getAgentMailAddress(alice.id);
      const bobAddress = await mailService.getAgentMailAddress(bob.id);

      // Send internal message
      const result = await mailService.send({
        from: aliceAddress!.address,
        to: bobAddress!.address,
        subject: 'Hello Bob',
        body: 'How are you?',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();

      // Verify message is stored
      const messages = await mailService.getMessages(bobAddress!.address);
      expect(messages.length).toBe(1);
      expect(messages[0].subject).toBe('Hello Bob');
      expect(messages[0].body).toBe('How are you?');

      db.close();
    });

    it('should queue external SMTP message', async () => {
      const { db, agentService, mailService } = await createTestFixtures();

      // Configure SMTP for agent
      const agent = agentService.register({ name: 'ExternalAgent', email: 'external@test.com' });
      await mailService.configureAgentSMTP(agent.id, {
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        user: 'test@gmail.com',
        password: 'password',
      });

      // Create mock sender
      mailService.setSmtpSender(mockSmtpSender);

      // Send to external address
      const result = await mailService.sendExternal({
        from: 'test@gmail.com',
        to: 'recipient@example.com',
        subject: 'External Email',
        body: 'This is an external email',
      }, agent.id);

      expect(result.queued).toBe(true);
      expect(result.queueId).toBeDefined();

      db.close();
    });
  });

  // ============================================================================
  // Tests: Queue Integration
  // ============================================================================

  describe('Queue Integration', () => {
    it('should return queue stats', async () => {
      const { db, agentService, mailService } = await createTestFixtures();

      const stats = mailService.getQueueStats();

      expect(stats).toHaveProperty('pending');
      expect(stats).toHaveProperty('processing');
      expect(stats).toHaveProperty('sent');
      expect(stats).toHaveProperty('failed');

      db.close();
    });

    it('should retry failed message', async () => {
      const { db, agentService, mailService } = await createTestFixtures();

      // Configure SMTP
      const agent = agentService.register({ name: 'RetryAgent', email: 'retry@test.com' });
      await mailService.configureAgentSMTP(agent.id, {
        host: 'smtp.gmail.com',
        port: 587,
        user: 'test@gmail.com',
        password: 'password',
      });

      // Get queue and directly restore a failed message
      const queue = mailService.getQueue();
      queue.restore([{
        id: 'failed-msg',
        from: 'test@gmail.com',
        to: 'recipient@example.com',
        subject: 'Failed',
        body: 'This will fail',
        maxRetries: 3,
        status: 'failed',
        retryCount: 3,
        createdAt: Date.now(),
      }]);

      // Retry
      const retried = queue.retry('failed-msg');
      expect(retried).toBe(true);

      const msg = queue.getById('failed-msg');
      expect(msg?.status).toBe('pending');
      expect(msg?.retryCount).toBe(0);

      db.close();
    });
  });

  // ============================================================================
  // Tests: IDLE State Persistence
  // ============================================================================

  describe('IDLE State', () => {
    it('should persist last UID', async () => {
      const { db, agentService, mailService } = await createTestFixtures();

      const agent = agentService.register({ name: 'IdleAgent', email: 'idle@test.com' });

      // Save IDLE state
      await mailService.saveIdleState(agent.id, 'inbox', 12345);

      // Load IDLE state
      const state = await mailService.getIdleState(agent.id);

      expect(state).toBeDefined();
      expect(state?.mailbox).toBe('inbox');
      expect(state?.lastUid).toBe(12345);

      db.close();
    });

    it('should return null for agent without IDLE state', async () => {
      const { db, agentService, mailService } = await createTestFixtures();

      const agent = agentService.register({ name: 'NoIdleAgent', email: 'noidle@test.com' });

      const state = await mailService.getIdleState(agent.id);
      expect(state).toBeNull();

      db.close();
    });
  });

  // ============================================================================
  // Tests: Address Management
  // ============================================================================

  describe('Address Management', () => {
    it('should list all agent addresses', async () => {
      const { db, agentService, mailService } = await createTestFixtures();

      // Register multiple agents
      const agents = [
        agentService.register({ name: 'Agent1', email: 'agent1@test.com' }),
        agentService.register({ name: 'Agent2', email: 'agent2@test.com' }),
        agentService.register({ name: 'Agent3', email: 'agent3@test.com' }),
      ];

      for (const agent of agents) {
        await mailService.registerAgentMailAddress(agent.id, agent.name);
      }

      const addresses = await mailService.listAddresses();

      expect(addresses.length).toBe(3);
      expect(addresses.every(a => a.agentId !== undefined)).toBe(true);

      db.close();
    });

    it('should detect internal vs external address', async () => {
      const { db, agentService, mailService } = await createTestFixtures();

      expect(mailService.isInternalAddress('alice@agent-mail.local')).toBe(true);
      expect(mailService.isInternalAddress('bob@external.com')).toBe(false);
      expect(mailService.isInternalAddress('test@gmail.com')).toBe(false);

      db.close();
    });
  });
});
