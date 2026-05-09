import type { MailboxService } from './mailbox-service';
import type { SendMessageInput } from './types';

export class HTTPServer {
  private server?: any;
  private port: number;
  private mailbox: MailboxService;

  constructor(
    mailbox: MailboxService,
    port = 3001
  ) {
    this.mailbox = mailbox;
    this.port = port;
  }

  async start(): Promise<void> {
    const self = this;
    const mailbox = this.mailbox;
    
    this.server = Bun.serve({
      port: this.port,
      async fetch(req: Request) {
        const url = new URL(req.url);
        const path = url.pathname;

        // Health check
        if (path === '/health') {
          return Response.json({ status: 'ok', timestamp: Date.now() });
        }

        // API routes
        if (path.startsWith('/api/v1/mail/')) {
          return self.handleApi(req, path, url, mailbox);
        }

        return Response.json({ error: 'Not found' }, { status: 404 });
      },
    });
  }

  private async handleApi(req: Request, path: string, url: URL, mailbox: MailboxService): Promise<Response> {
    const method = req.method;

    // POST /api/v1/mail/addresses - Register address
    if (method === 'POST' && path === '/api/v1/mail/addresses') {
      const body = await req.json() as { agentId?: string; name?: string };
      if (!body.agentId || !body.name) {
        return Response.json({ error: 'agentId and name required' }, { status: 400 });
      }
      const addr = mailbox.registerAddress(body.agentId, body.name);
      return Response.json(addr, { status: 201 });
    }

    // GET /api/v1/mail/addresses - List addresses
    if (method === 'GET' && path === '/api/v1/mail/addresses') {
      const addrs = mailbox.listAddresses();
      return Response.json(addrs);
    }

    // POST /api/v1/mail/send - Send message
    if (method === 'POST' && path === '/api/v1/mail/send') {
      const body = await req.json() as { fromAddress?: string; toAddress?: string; subject?: string; body?: string };
      const input: SendMessageInput = {
        fromAddress: body.fromAddress || '',
        toAddress: body.toAddress || '',
        subject: body.subject,
        body: body.body || '',
      };
      
      if (!input.fromAddress || !input.toAddress || !input.body) {
        return Response.json({ error: 'fromAddress, toAddress, body required' }, { status: 400 });
      }
      
      const msg = mailbox.send(input);
      return Response.json(msg, { status: 201 });
    }

    // GET /api/v1/mail/inbox - Get inbox
    if (method === 'GET' && path === '/api/v1/mail/inbox') {
      const address = url.searchParams.get('address');
      if (!address) {
        return Response.json({ error: 'address query param required' }, { status: 400 });
      }
      
      const unreadOnly = url.searchParams.get('unreadOnly') === 'true';
      const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!) : undefined;
      
      const messages = mailbox.getInbox(address, { unreadOnly, limit });
      return Response.json(messages);
    }

    // GET /api/v1/mail/inbox/:id - Get single message
    if (method === 'GET' && path.startsWith('/api/v1/mail/inbox/')) {
      const id = path.split('/').pop()!;
      const msg = mailbox.getMessage(id);
      if (!msg) {
        return Response.json({ error: 'Message not found' }, { status: 404 });
      }
      return Response.json(msg);
    }

    // PUT /api/v1/mail/read/:id - Mark as read
    if (method === 'PUT' && path.startsWith('/api/v1/mail/read/')) {
      const id = path.split('/').pop()!;
      const success = mailbox.markAsRead(id);
      return Response.json({ success });
    }

    // DELETE /api/v1/mail/:id - Delete message
    if (method === 'DELETE' && path.startsWith('/api/v1/mail/')) {
      const id = path.split('/').pop()!;
      const success = mailbox.deleteMessage(id);
      return Response.json({ success });
    }

    return Response.json({ error: 'Route not found' }, { status: 404 });
  }

  stop(): void {
    if (this.server) {
      this.server.stop();
      this.server = undefined;
    }
  }

  getPort(): number {
    return this.port;
  }
}
