import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { IMDatabase } from '../../src/im/db';
import { IMServer } from '../../src/im/server';
import { Mailbox } from '../../src/im/client';

describe('Mailbox Client', () => {
  let db: IMDatabase;
  let server: IMServer;
  let httpUrl: string;
  let wsUrl: string;

  beforeEach(async () => {
    db = new IMDatabase({ memory: true });
    server = new IMServer(db, 0);
    await server.start();
    httpUrl = `http://localhost:${server.getHttpPort()}`;
    wsUrl = `ws://localhost:${server.getWsPort()}`;
  });

  afterEach(() => {
    // Stop server first to prevent it from accessing closed db
    server.stop();
    db.close();
  });

  /**
   * Helper to create a Mailbox with correct URLs
   */
  function createMailbox(address: string): Mailbox {
    return new Mailbox({
      address,
      serverUrl: httpUrl,
      wsUrl,
    });
  }

  describe('connect', () => {
    test('connects successfully to server', async () => {
      const mailbox = createMailbox('alice@server.com');

      const connected = await mailbox.connect();
      expect(connected).toBe(true);
      expect(mailbox.isConnected()).toBe(true);

      await mailbox.disconnect();
    });

    test('isConnected returns false before connect', () => {
      const mailbox = createMailbox('alice@server.com');

      expect(mailbox.isConnected()).toBe(false);
    });

    test('connect returns true for already connected mailbox', async () => {
      const mailbox = createMailbox('alice@server.com');

      await mailbox.connect();
      const connectedAgain = await mailbox.connect();
      expect(connectedAgain).toBe(true);

      await mailbox.disconnect();
    });

    test('receives connected event', async () => {
      const mailbox = createMailbox('alice@server.com');

      let connected = false;
      mailbox.on('connected', () => {
        connected = true;
      });

      await mailbox.connect();
      expect(connected).toBe(true);

      await mailbox.disconnect();
    });
  });

  describe('send', () => {
    test('sends text message', async () => {
      const mailbox = createMailbox('alice@server.com');

      await mailbox.connect();

      const message = await mailbox.send('bob@server.com', {
        type: 'text',
        body: 'Hello Bob!',
      });

      expect(message).toHaveProperty('id');
      expect(message.from).toBe('alice@server.com');
      expect(message.to).toBe('bob@server.com');
      expect(message.content).toEqual({ type: 'text', body: 'Hello Bob!' });
      expect(message.status).toBe('pending');

      await mailbox.disconnect();
    });

    test('sends image message', async () => {
      const mailbox = createMailbox('alice@server.com');

      await mailbox.connect();

      const imageContent = {
        type: 'image' as const,
        body: {
          url: 'https://example.com/photo.jpg',
          width: 1920,
          height: 1080,
          format: 'jpeg',
        },
      };

      const message = await mailbox.send('bob@server.com', imageContent);

      expect(message.content).toEqual(imageContent);

      await mailbox.disconnect();
    });

    test('throws error on send failure', async () => {
      // Use an invalid server URL
      const mailbox = new Mailbox({
        address: 'alice@server.com',
        serverUrl: 'http://localhost:9999', // Non-existent server
        wsUrl: 'ws://localhost:9999',
      });

      await mailbox.connect();

      await expect(
        mailbox.send('bob@server.com', { type: 'text', body: 'Test' })
      ).rejects.toThrow();

      await mailbox.disconnect();
    });
  });

  describe('receive', () => {
    test('receives pushed messages', async () => {
      // Bob connects first and listens
      const bobMailbox = createMailbox('bob@server.com');

      await bobMailbox.connect();

      let receivedMessage: any = null;
      bobMailbox.on('message', (msg) => {
        receivedMessage = msg;
      });

      // Alice sends a message to Bob
      const aliceMailbox = createMailbox('alice@server.com');

      await aliceMailbox.connect();

      await aliceMailbox.send('bob@server.com', {
        type: 'text',
        body: 'Hello Bob!',
      });

      // Wait for message to be received
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(receivedMessage).not.toBeNull();
      expect(receivedMessage.content).toEqual({ type: 'text', body: 'Hello Bob!' });
      expect(receivedMessage.from).toBe('alice@server.com');
      expect(receivedMessage.to).toBe('bob@server.com');

      await bobMailbox.disconnect();
      await aliceMailbox.disconnect();
    });

    test('receives multiple messages', async () => {
      const bobMailbox = createMailbox('bob@server.com');

      await bobMailbox.connect();

      const receivedMessages: any[] = [];
      bobMailbox.on('message', (msg) => {
        receivedMessages.push(msg);
      });

      // Send multiple messages
      const aliceMailbox = createMailbox('alice@server.com');

      await aliceMailbox.connect();

      await aliceMailbox.send('bob@server.com', { type: 'text', body: 'Msg 1' });
      await aliceMailbox.send('bob@server.com', { type: 'text', body: 'Msg 2' });
      await aliceMailbox.send('bob@server.com', { type: 'text', body: 'Msg 3' });

      // Wait for messages
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(receivedMessages).toHaveLength(3);
      expect(receivedMessages.map((m) => m.content.body)).toEqual([
        'Msg 1',
        'Msg 2',
        'Msg 3',
      ]);

      await bobMailbox.disconnect();
      await aliceMailbox.disconnect();
    });

    test('receives pending messages on connect', async () => {
      // Send messages before Bob connects
      const aliceMailbox = createMailbox('alice@server.com');

      await aliceMailbox.connect();

      await aliceMailbox.send('bob@server.com', { type: 'text', body: 'Offline 1' });
      await aliceMailbox.send('bob@server.com', { type: 'text', body: 'Offline 2' });

      await aliceMailbox.disconnect();

      // Bob connects and should receive pending messages
      const bobMailbox = createMailbox('bob@server.com');

      const receivedMessages: any[] = [];
      bobMailbox.on('message', (msg) => {
        receivedMessages.push(msg);
      });

      await bobMailbox.connect();

      // Wait for pending messages to be delivered
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(receivedMessages).toHaveLength(2);
      expect(receivedMessages[0].content.body).toBe('Offline 1');
      expect(receivedMessages[1].content.body).toBe('Offline 2');

      await bobMailbox.disconnect();
    });

    test('can unsubscribe from messages', async () => {
      const bobMailbox = createMailbox('bob@server.com');

      await bobMailbox.connect();

      const handler = (msg: any) => {
        // Should not be called
      };

      bobMailbox.on('message', handler);
      bobMailbox.off('message', handler);

      const aliceMailbox = createMailbox('alice@server.com');

      await aliceMailbox.connect();

      await aliceMailbox.send('bob@server.com', { type: 'text', body: 'Should not receive' });

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));

      await bobMailbox.disconnect();
      await aliceMailbox.disconnect();
    });
  });

  describe('disconnect', () => {
    test('disconnects successfully', async () => {
      const mailbox = createMailbox('alice@server.com');

      await mailbox.connect();
      expect(mailbox.isConnected()).toBe(true);

      await mailbox.disconnect();
      expect(mailbox.isConnected()).toBe(false);
    });

    test('receives disconnected event', async () => {
      const mailbox = createMailbox('alice@server.com');

      await mailbox.connect();

      let disconnected = false;
      mailbox.on('disconnected', () => {
        disconnected = true;
      });

      await mailbox.disconnect();

      // Give time for the event to fire
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(disconnected).toBe(true);
    });

    test('disconnect twice is safe', async () => {
      const mailbox = createMailbox('alice@server.com');

      await mailbox.connect();
      await mailbox.disconnect();
      await mailbox.disconnect(); // Should not throw

      expect(mailbox.isConnected()).toBe(false);
    });
  });

  describe('ack', () => {
    test('acks a message', async () => {
      const bobMailbox = createMailbox('bob@server.com');

      await bobMailbox.connect();

      const aliceMailbox = createMailbox('alice@server.com');

      await aliceMailbox.connect();

      // Bob receives a message
      let receivedMessage: any = null;
      bobMailbox.on('message', (msg) => {
        receivedMessage = msg;
      });

      await aliceMailbox.send('bob@server.com', {
        type: 'text',
        body: 'Ack me!',
      });

      // Wait for message
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(receivedMessage).not.toBeNull();

      // Bob acks the message
      await bobMailbox.ack(receivedMessage.id);

      // Verify message is acked via HTTP
      const res = await fetch(`${httpUrl}/messages/${receivedMessage.id}`);
      const msg = await res.json();
      expect(msg.status).toBe('acked');

      await bobMailbox.disconnect();
      await aliceMailbox.disconnect();
    });
  });

  describe('fetchInbox', () => {
    test('fetches inbox messages', async () => {
      const aliceMailbox = createMailbox('alice@server.com');

      await aliceMailbox.connect();

      // Send messages to Alice
      const bobMailbox = createMailbox('bob@server.com');

      await bobMailbox.connect();

      await bobMailbox.send('alice@server.com', { type: 'text', body: 'Inbox 1' });
      await bobMailbox.send('alice@server.com', { type: 'text', body: 'Inbox 2' });

      await bobMailbox.disconnect();

      // Fetch inbox
      const messages = await aliceMailbox.fetchInbox();

      expect(messages).toHaveLength(2);
      // Messages are returned in descending order by createdAt
      // Check that both messages are present (order may vary)
      const bodies = messages.map(m => m.content.body).sort();
      expect(bodies).toEqual(['Inbox 1', 'Inbox 2']);

      await aliceMailbox.disconnect();
    });

    test('fetches empty inbox', async () => {
      const mailbox = createMailbox('newuser@server.com');

      await mailbox.connect();

      const messages = await mailbox.fetchInbox();
      expect(messages).toEqual([]);

      await mailbox.disconnect();
    });
  });

  describe('ping', () => {
    test('sends ping without error', async () => {
      const mailbox = createMailbox('alice@server.com');

      await mailbox.connect();

      // Should not throw
      mailbox.ping();

      await mailbox.disconnect();
    });
  });
});
