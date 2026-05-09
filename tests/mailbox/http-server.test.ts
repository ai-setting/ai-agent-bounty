import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from '../../src/lib/storage/database';
import { EventBus } from '../../src/lib/mailbox/event-bus';
import { MailboxService } from '../../src/lib/mailbox/mailbox-service';
import { HTTPServer } from '../../src/lib/mailbox/http-server';

describe('HTTPServer', () => {
  let db: Database;
  let eventBus: EventBus;
  let service: MailboxService;
  let server: HTTPServer;
  let port = 0; // Will be dynamically assigned

  beforeEach(() => {
    db = new Database({ memory: true });
    eventBus = new EventBus();
    service = new MailboxService(db, eventBus);
    port += 1000; // Increment port to avoid conflicts
  });

  afterEach(() => {
    server?.stop();
  });

  it('should return health status', async () => {
    server = new HTTPServer(service, 3456 + port);
    await server.start();
    
    const res = await fetch(`http://localhost:${3456 + port}/health`);
    const body = await res.json();
    
    expect(res.status).toBe(200);
    expect(body.status).toBe('ok');
  });

  it('should register address via API', async () => {
    server = new HTTPServer(service, 3456 + port);
    await server.start();
    
    const res = await fetch(`http://localhost:${3456 + port}/api/v1/mail/addresses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'agent-1', name: 'Alice' }),
    });
    
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.address).toBe('alice@local');
  });

  it('should list addresses via API', async () => {
    server = new HTTPServer(service, 3456 + port);
    service.registerAddress('agent-2', 'Bob');
    await server.start();
    
    const res = await fetch(`http://localhost:${3456 + port}/api/v1/mail/addresses`);
    const body = await res.json();
    
    expect(body.length).toBe(1);
    expect(body[0].address).toBe('bob@local');
  });

  it('should send message via API', async () => {
    server = new HTTPServer(service, 3456 + port);
    service.registerAddress('alice', 'Alice');
    service.registerAddress('bob', 'Bob');
    await server.start();
    
    const res = await fetch(`http://localhost:${3456 + port}/api/v1/mail/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromAddress: 'alice@local',
        toAddress: 'bob@local',
        subject: 'Hello',
        body: 'Test message',
      }),
    });
    
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('sent');
  });

  it('should get inbox via API', async () => {
    server = new HTTPServer(service, 3456 + port);
    service.registerAddress('alice-inbox', 'AliceInbox');
    service.registerAddress('bob-inbox', 'BobInbox');
    service.send({
      fromAddress: 'alice-inbox@local',
      toAddress: 'bob-inbox@local',
      body: 'Hello inbox',
    });
    await server.start();
    
    const res = await fetch(`http://localhost:${3456 + port}/api/v1/mail/inbox?address=bob-inbox@local`);
    const body = await res.json();
    
    expect(body.length).toBe(1);
    expect(body[0].body).toBe('Hello inbox');
  });

  it('should mark message as read via API', async () => {
    server = new HTTPServer(service, 3456 + port);
    service.registerAddress('alice-read', 'AliceRead');
    service.registerAddress('bob-read', 'BobRead');
    const msg = service.send({
      fromAddress: 'alice-read@local',
      toAddress: 'bob-read@local',
      body: 'Read me',
    });
    await server.start();
    
    const res = await fetch(`http://localhost:${3456 + port}/api/v1/mail/read/${msg.id}`, {
      method: 'PUT',
    });
    
    expect(res.status).toBe(200);
  });

  it('should return 400 for invalid request', async () => {
    server = new HTTPServer(service, 3456 + port);
    await server.start();
    
    const res = await fetch(`http://localhost:${3456 + port}/api/v1/mail/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromAddress: 'invalid' }),
    });
    
    expect(res.status).toBe(400);
  });
});
