import { createIMServer, IMServer, type IMServerConfig } from '../server';
import { Mailbox, type MailboxConfig } from '../client';
import type { Message, Content } from '../types';

export interface CLIConfig {
  /** Server URL for HTTP requests */
  serverUrl?: string;
  /** Default from address */
  from?: string;
}

export class IMCLI {
  private config: CLIConfig;
  private runningServer?: IMServer;
  private serverUrl?: string;

  constructor(config: CLIConfig = {}) {
    this.config = config;
  }

  /**
   * Start the IM server
   */
  async startServer(port: number = 3001, dbPath: string = ':memory:'): Promise<void> {
    const serverConfig: IMServerConfig = {
      port,
      memory: dbPath === ':memory:',
      dbPath: dbPath === ':memory:' ? undefined : dbPath,
    };

    this.runningServer = await createIMServer(serverConfig);
    this.serverUrl = `http://localhost:${this.runningServer.getHttpPort()}`;
    
    console.log(`IM Server started on port ${this.runningServer.getHttpPort()}`);
    console.log(`WebSocket server started on port ${this.runningServer.getWsPort()}`);
    
    // Keep the process running
    await this.keepAlive();
  }

  /**
   * Send a message to a recipient
   */
  async send(to: string, content: string, serverUrl?: string): Promise<void> {
    const url = serverUrl || this.serverUrl;
    
    if (!url) {
      throw new Error('Server not running. Use "startServer" command first or provide serverUrl');
    }

    const from = this.config.from || 'anonymous@cli';
    
    const response = await fetch(`${url}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        content: {
          type: 'text',
          body: content,
        } as Content,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send message: ${error}`);
    }

    const message = await response.json() as { id: string };
    console.log(`Message sent to ${to}: ${message.id}`);
  }

  /**
   * Listen for messages on an address
   */
  async listen(address: string, serverUrl?: string): Promise<void> {
    const url = serverUrl || this.serverUrl || 'http://localhost:3001';
    
    const mailboxConfig: MailboxConfig = {
      address,
      serverUrl: url,
    };

    const mailbox = new Mailbox(mailboxConfig);

    mailbox.on('connected', () => {
      console.log(`Connected as ${address}`);
    });

    mailbox.on('message', (msg: unknown) => {
      const m = msg as Message;
      console.log(`\n[${m.from}] ${JSON.stringify(m.content)}`);
    });

    mailbox.on('disconnected', (reason?: string) => {
      console.log(`Disconnected: ${reason || 'unknown reason'}`);
    });

    await mailbox.connect();

    // Keep the process running
    await this.keepAlive();
  }

  /**
   * Health check on the server
   */
  async health(serverUrl?: string): Promise<void> {
    const url = serverUrl || this.serverUrl;
    
    if (!url) {
      throw new Error('No server URL provided. Use "startServer" command first or provide serverUrl');
    }

    const response = await fetch(`${url}/health`);

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    const data = await response.json() as { status: string; timestamp: number };
    console.log(`Server is healthy:`);
    console.log(`  Status: ${data.status}`);
    console.log(`  Timestamp: ${new Date(data.timestamp).toISOString()}`);
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (this.runningServer) {
      this.runningServer.stop();
      this.runningServer = undefined;
      this.serverUrl = undefined;
      console.log('Server stopped');
    }
  }

  /**
   * Keep the process running indefinitely
   */
  private async keepAlive(): Promise<void> {
    return new Promise(() => {});
  }
}

// CLI entry point
export async function runCLI(args: string[]): Promise<void> {
  const cli = new IMCLI();
  const command = args[0];
  const restArgs = args.slice(1);

  try {
    switch (command) {
      case 'server': {
        const port = parseInt(getArg(restArgs, '--port', '-p') || '3001');
        const dbPath = getArg(restArgs, '--db-path', '-d') || ':memory:';
        await cli.startServer(port, dbPath);
        break;
      }

      case 'send': {
        const to = getArg(restArgs, '--to', '-t');
        const content = getArg(restArgs, '--content', '-c') || restArgs.find(a => !a.startsWith('-'));
        const from = getArg(restArgs, '--from', '-f');
        const serverUrl = getArg(restArgs, '--server-url', '-s') || 'http://localhost:3001';
        
        if (!to) {
          throw new Error('--to is required for send command');
        }
        if (!content) {
          throw new Error('Message content is required');
        }

        const sendCli = from ? new IMCLI({ from }) : cli;
        await sendCli.send(to, content, serverUrl);
        break;
      }

      case 'listen': {
        const address = getArg(restArgs, '--address', '-a');
        const serverUrl = getArg(restArgs, '--server-url', '-s');
        
        if (!address) {
          throw new Error('--address is required for listen command');
        }

        await cli.listen(address, serverUrl);
        break;
      }

      case 'health': {
        const serverUrl = getArg(restArgs, '--server-url', '-s') || 'http://localhost:3001';
        await cli.health(serverUrl);
        break;
      }

      case 'stop':
        await cli.stop();
        break;

      default:
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

function getArg(args: string[], longName: string, shortName?: string): string | undefined {
  const longIndex = args.indexOf(longName);
  if (longIndex !== -1 && longIndex + 1 < args.length) {
    return args[longIndex + 1];
  }
  
  if (shortName) {
    const shortIndex = args.indexOf(shortName);
    if (shortIndex !== -1 && shortIndex + 1 < args.length) {
      return args[shortIndex + 1];
    }
  }
  
  return undefined;
}

function printUsage(): void {
  console.log(`
Usage: agent-im <command> [options]

Commands:
  server        Start the IM server
  send          Send a message
  listen        Listen for messages
  health        Check server health
  stop          Stop the server

Options:
  --port, -p         Server port (default: 3001)
  --db-path, -d      Database path (default: :memory:)
  --to, -t           Recipient address
  --from, -f         Sender address
  --content, -c      Message content
  --address, -a      Your address for listening
  --server-url, -s   Server URL

Examples:
  agent-im server --port 3001 --db-path ./data/im.db
  agent-im send --to alice@server.com --content "Hello!"
  agent-im listen --address bob@server.com
  agent-im health --server-url http://localhost:3001
`);
}
