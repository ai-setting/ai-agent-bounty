import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from '../../src/lib/storage/database';
import { EventBus } from '../../src/lib/mailbox/event-bus';
import { MailboxService } from '../../src/lib/mailbox/mailbox-service';
import { WebSocketServer } from '../../src/lib/mailbox/websocket-server';

describe('WebSocketServer', () => {
  let db: Database;
  let eventBus: EventBus;
  let service: MailboxService;
  let wsServer: WebSocketServer;
  let port = 4500;

  beforeEach(() => {
    db = new Database({ memory: true });
    eventBus = new EventBus();
    service = new MailboxService(db, eventBus);
    port += 100;
  });

  afterEach(() => {
    wsServer?.stop();
  });

  it('should start server', async () => {
    wsServer = new WebSocketServer(service, port);
    await wsServer.start();
    expect(wsServer.getPort()).toBe(port);
    wsServer.stop();
  });

  it('should accept websocket connection', async () => {
    wsServer = new WebSocketServer(service, port);
    await wsServer.start();
    
    service.registerAddress('agent-ws-1', 'AgentWS1');
    
    const ws = new WebSocket(`ws://localhost:${port}/ws/agent/agent-ws-1`);
    
    await new Promise<void>((resolve) => {
      ws.addEventListener('open', () => {
        resolve();
      });
    });
    
    ws.close();
  });

  it('should receive message via websocket', async () => {
    wsServer = new WebSocketServer(service, port);
    await wsServer.start();
    
    service.registerAddress('alicews', 'AliceWS');
    service.registerAddress('bobws', 'BobWS');
    
    // Connect Bob - use the agent ID that was registered
    const bobWs = new WebSocket(`ws://localhost:${port}/ws/agent/bobws`);
    
    // Wait for connected message first
    await new Promise<void>((resolve) => {
      bobWs.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'connected') resolve();
      });
    });

    // Get Bob's and Alice's actual addresses
    const bobAddr = service.getAddressByAgent('bobws')!;
    const aliceAddr = service.getAddressByAgent('alicews')!;
    
    // Send message to Bob using actual addresses
    service.send({
      fromAddress: aliceAddr.address, // alicews@local
      toAddress: bobAddr.address,     // bobws@local
      body: 'Hello via WebSocket',
    });

    // Wait for message
    const message = await new Promise<any>((resolve) => {
      bobWs.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'message.received') resolve(msg);
      });
    });

    expect(message.type).toBe('message.received');
    expect(message.data.body).toBe('Hello via WebSocket');

    bobWs.close();
  });

  it('should handle heartbeat ping/pong', async () => {
    wsServer = new WebSocketServer(service, port);
    await wsServer.start();
    
    service.registerAddress('agent-ping', 'AgentPing');
    
    const ws = new WebSocket(`ws://localhost:${port}/ws/agent/agent-ping`);
    
    // Wait for connected message first
    await new Promise<void>((resolve) => {
      ws.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'connected') resolve();
      });
    });

    // Send ping
    ws.send(JSON.stringify({ type: 'ping' }));

    // Should receive pong
    const response = await new Promise<any>((resolve) => {
      ws.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'pong') resolve(msg);
      });
    });

    expect(response.type).toBe('pong');
    ws.close();
  });
});
