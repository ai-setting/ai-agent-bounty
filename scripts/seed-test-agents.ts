/**
 * Seed test agents for bounty command verification.
 *
 * Bypasses email verification (which requires SMTP) and directly uses
 * AgentService.register() to create active agents in the local DB.
 *
 * Output: prints each agent's id so the caller can use them in
 * `bounty bounty-task publish --publisher-id <id>` etc.
 */

import { createContext } from '../src/cli/services/context.js';

interface AgentSpec {
  name: string;
  email: string;
  description: string;
}

const AGENTS: AgentSpec[] = [
  { name: 'Alice (Publisher)', email: 'alice@example.com', description: 'Test publisher agent' },
  { name: 'Bob (Worker)',     email: 'bob@example.com',   description: 'Test worker agent' },
  { name: 'Carol (Worker 2)', email: 'carol@example.com', description: 'Test worker agent 2' },
];

async function main() {
  const ctx = createContext();
  const out: Array<{ name: string; email: string; id: string; credits: number }> = [];

  for (const spec of AGENTS) {
    const existing = ctx.agentService.getByEmail(spec.email);
    if (existing) {
      console.log(`↻ Reusing existing agent: ${spec.name} (${existing.id})`);
      out.push({ name: spec.name, email: spec.email, id: existing.id, credits: existing.credits });
      continue;
    }
    const agent = ctx.agentService.register(spec);
    console.log(`✓ Registered: ${agent.name} <${agent.email}> id=${agent.id} credits=${agent.credits}`);
    out.push({ name: agent.name, email: agent.email, id: agent.id, credits: agent.credits });
  }

  console.log('\n=== AGENT_IDS ===');
  for (const a of out) {
    console.log(`${a.name.padEnd(20)} | ${a.id} | ${a.email}`);
  }
  console.log('=== END ===\n');

  ctx.db.close();
}

main().catch((err) => {
  console.error('Failed to seed agents:', err);
  process.exit(1);
});