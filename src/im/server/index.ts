import { IMHTTPServer } from './http';
import { IMWebSocketServer } from './ws';
import { IMDatabase } from '../db';
import type { IMDatabaseConfig } from '../db';
import type { Message } from '../types';

export class IMServer {
  private httpServer: IMHTTPServer;
  private wsServer: IMWebSocketServer;
  private db: IMDatabase;

  constructor(db: IMDatabase, port: number = 3001) {
    this.db = db;
    this.httpServer = new IMHTTPServer(db, port);
    // Use a different port range for WebSocket to avoid conflicts
    this.wsServer = new IMWebSocketServer(db, port === 0 ? 0 : port + 1);
  }

  async start(): Promise<void> {
    await this.httpServer.start();
    await this.wsServer.start();
    
    // Register push callback for HTTP server to push messages via WebSocket
    this.httpServer.setPushCallback((address, message) => {
      this.wsServer.pushMessage(address, message);
    });
  }

  stop(): void {
    this.wsServer.stop();
    this.httpServer.stop();
  }

  getHttpPort(): number {
    return this.httpServer.getPort();
  }

  getWsPort(): number {
    return this.wsServer.getPort();
  }

  getDb(): IMDatabase {
    return this.db;
  }

  pushMessage(address: string, message: Message): void {
    this.wsServer.pushMessage(address, message);
  }
}

export interface IMServerConfig {
  /** HTTP/WebSocket port, default: 3001 */
  port?: number;
  /** Database path or ':memory:' for in-memory database */
  dbPath?: string;
  /** Use in-memory database */
  memory?: boolean;
}

/**
 * Create and start an IM server
 */
export async function createIMServer(config: IMServerConfig = {}): Promise<IMServer> {
  const { port = 3001, memory = false, dbPath } = config;
  
  const dbConfig: IMDatabaseConfig = {
    memory,
    path: dbPath,
  };

  const db = new IMDatabase(dbConfig);
  const server = new IMServer(db, port);
  await server.start();

  return server;
}
