/**
 * Bounty Server Entry Point
 * 
 * Single server with both HTTP and WebSocket on the same port
 */

import { Database } from '../lib/storage/database.js';
import { IMDatabase } from '../im/db/index.js';
import { BountyHTTPServer } from './http/index.js';

async function main() {
  const port = parseInt(process.env.BOUNTY_PORT || '4000', 10);
  const dbPath = process.env.BOUNTY_DB_PATH || './data/bounty.db';

  console.log(`🚀 Starting Bounty Server...`);
  console.log(`   Port: ${port}`);
  console.log(`   DB: ${dbPath}`);

  // Initialize databases (they share the same SQLite file)
  const bountyDb = new Database({ path: dbPath });
  const imDb = new IMDatabase({ path: dbPath });

  // Start server with HTTP + WebSocket
  const server = new BountyHTTPServer({
    imDb,
    bountyDb,
    port,
  });

  // Set push callback for real-time WebSocket message delivery
  // This enables instant message push when agents send messages via HTTP API
  server.setPushCallback((address, message) => {
    return server.pushMessage(address, message);
  });

  server.start();

  console.log(`✅ Bounty Server running!`);
  console.log(`   HTTP: http://localhost:${port}`);
  console.log(`   WebSocket: ws://localhost:${port}/ws`);
  console.log(`   Health: http://localhost:${port}/health`);

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n🛑 Shutting down...');
    server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});
