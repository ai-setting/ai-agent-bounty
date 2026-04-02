/**
 * Basic tests for agent-bounty
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from '../src/lib/storage/database.js';
import { AgentService } from '../src/lib/agent/index.js';
import { BountyService } from '../src/lib/bounty/index.js';
import { MailService } from '../src/lib/mail/index.js';

describe('Agent Bounty System', () => {
  let db: Database;
  let agentService: AgentService;
  let bountyService: BountyService;
  let mailService: MailService;

  beforeAll(() => {
    db = new Database({ memory: true });
    agentService = new AgentService(db);
    bountyService = new BountyService(db, agentService);
    mailService = new MailService(db);
  });

  afterAll(() => {
    db.close();
  });

  describe('Agent Registration', () => {
    it('should register a new agent', () => {
      const agent = agentService.register({
        name: 'TestAgent',
        email: 'test@example.com',
        description: 'A test agent',
      });

      expect(agent).toBeDefined();
      expect(agent.name).toBe('TestAgent');
      expect(agent.email).toBe('test@example.com');
      expect(agent.credits).toBe(100); // Initial credits
      expect(agent.status).toBe('active');
    });

    it('should generate mail address for agent', () => {
      const agent = agentService.getByEmail('test@example.com')!;
      const mail = mailService.registerAddress(agent.id, agent.name);

      expect(mail).toBeDefined();
      expect(mail.address).toContain('testagent');
      expect(mail.agentId).toBe(agent.id);
    });

    it('should throw error for duplicate email', () => {
      expect(() => {
        agentService.register({
          name: 'AnotherAgent',
          email: 'test@example.com',
        });
      }).toThrow();
    });
  });

  describe('Task Bounty', () => {
    let publisherAgent: any;
    let workerAgent: any;

    beforeAll(() => {
      publisherAgent = agentService.register({
        name: 'Publisher',
        email: 'publisher@example.com',
      });

      workerAgent = agentService.register({
        name: 'Worker',
        email: 'worker@example.com',
      });
    });

    it('should publish a task', () => {
      const task = bountyService.publish({
        title: 'Test Task',
        description: 'A test bounty task',
        type: 'testing',
        reward: 50,
        publisherId: publisherAgent.id,
        publisherEmail: publisherAgent.email,
      });

      expect(task).toBeDefined();
      expect(task.title).toBe('Test Task');
      expect(task.status).toBe('open');
      expect(task.reward).toBe(50);
    });

    it('should deduct credits on publish', () => {
      const publisher = agentService.getById(publisherAgent.id)!;
      expect(publisher.credits).toBe(50); // 100 - 50
    });

    it('should list open tasks', () => {
      const tasks = bountyService.getBoard();
      expect(tasks.length).toBeGreaterThan(0);
      expect(tasks.every(t => t.status === 'open')).toBe(true);
    });

    it('should grab a task', () => {
      const task = bountyService.list()[0];
      const result = bountyService.grab(task.id, workerAgent.id, workerAgent.email);

      expect(result.success).toBe(true);

      const updatedTask = bountyService.getById(task.id)!;
      expect(updatedTask.status).toBe('grabbed');
      expect(updatedTask.assigneeId).toBe(workerAgent.id);
    });

    it('should submit task result', () => {
      const task = bountyService.list({ status: 'grabbed' })[0];
      const result = bountyService.submit(task.id, workerAgent.id, 'Task completed!');

      expect(result.success).toBe(true);

      const updatedTask = bountyService.getById(task.id)!;
      expect(updatedTask.status).toBe('submitted');
      expect(updatedTask.result).toBe('Task completed!');
    });

    it('should complete task and release escrow', () => {
      const task = bountyService.list({ status: 'submitted' })[0];
      const workerBefore = agentService.getById(workerAgent.id)!;
      
      const result = bountyService.complete(task.id, publisherAgent.id);

      expect(result.success).toBe(true);

      const updatedTask = bountyService.getById(task.id)!;
      expect(updatedTask.status).toBe('completed');

      const workerAfter = agentService.getById(workerAgent.id)!;
      expect(workerAfter.credits).toBe(workerBefore.credits + task.reward);
    });
  });

  describe('Mail System', () => {
    let agent1: any;
    let agent2: any;

    beforeAll(() => {
      agent1 = agentService.register({
        name: 'MailUser1',
        email: 'mailuser1@example.com',
      });

      agent2 = agentService.register({
        name: 'MailUser2',
        email: 'mailuser2@example.com',
      });

      mailService.registerAddress(agent1.id, agent1.name);
      mailService.registerAddress(agent2.id, agent2.name);
    });

    it('should send message between agents', () => {
      const addr1 = mailService.getAddressByAgent(agent1.id)!;
      const addr2 = mailService.getAddressByAgent(agent2.id)!;

      const message = mailService.send({
        fromAddress: addr1.address,
        toAddress: addr2.address,
        subject: 'Hello',
        body: 'Test message content',
      });

      expect(message).toBeDefined();
      expect(message.status).toBe('sent');
    });

    it('should receive message in inbox', () => {
      const addr2 = mailService.getAddressByAgent(agent2.id)!;
      const messages = mailService.getMessages(addr2.address);

      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0].subject).toBe('Hello');
    });

    it('should mark message as read', () => {
      const addr2 = mailService.getAddressByAgent(agent2.id)!;
      const messages = mailService.getMessages(addr2.address);
      const msg = messages[0];

      const result = mailService.markAsRead(msg.id);
      expect(result).toBe(true);

      const updated = mailService.getMessage(msg.id)!;
      expect(updated.status).toBe('read');
    });
  });
});
