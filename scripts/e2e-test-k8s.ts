#!/usr/bin/env bun
/**
 * E2E Test: Bounty Service on K8s
 *
 * Tests:
 * 1. Register two agents (publisher + grabber)
 * 2. Verify emails (fetch codes from pod DB via local sqlite3)
 * 3. Login to get tokens
 * 4. Publish a bounty task
 * 5. Grab the task
 * 6. Submit result
 * 7. Complete the task
 * 8. Agent-to-agent IM communication
 */



const BASE = 'http://10.1.54.172:4005';
const POD = 'bounty-server-7ff8895969-8f2sm';
const NS = 'tongagent';

function api(path: string, opts: RequestInit = {}) {
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers as Record<string, string>) },
  });
}

async function json(resp: Response) {
  const data = await resp.json();
  console.log(`  → ${resp.status}:`, JSON.stringify(data, null, 2).slice(0, 400));
  return data;
}

async function getCodeFromPod(email: string): Promise<string> {
  // Copy DB from pod to local temp file via shell
  const tmpDb = `/tmp/bounty_pod_${Date.now()}.db`;
  const proc = Bun.spawnSync(['sh', '-c', `kubectl exec ${POD} -n ${NS} -- cat /app/data/bounty.db > ${tmpDb}`]);
  if (proc.exitCode !== 0) throw new Error('Failed to copy DB from pod');

  // Query locally using sqlite3 CLI
  const result = Bun.spawnSync(['sqlite3', tmpDb, `SELECT code FROM verifications WHERE email = '${email}' ORDER BY created_at DESC LIMIT 1`]);
  const code = result.stdout.toString().trim();
  // Clean up
  try { Bun.spawnSync(['rm', '-f', tmpDb]); } catch {}
  
  if (!code) throw new Error(`No verification code found for ${email}`);
  return code;
}

async function main() {
  console.log('='.repeat(60));
  console.log('🧪 BOUNTY SERVICE E2E TEST');
  console.log('='.repeat(60));
  console.log(`Server: ${BASE}\n`);

  // ===== 1. Health Check =====
  console.log('📋 1. Health Check');
  const health = await api('/health');
  console.log(`  → ${health.status}:`, await health.text());
  console.log();

  // ===== 2. Register Agents =====
  console.log('📋 2. Register Agents');

  const pubEmail = `publisher-${Date.now()}@test.bounty`;
  const grabEmail = `grabber-${Date.now()}@test.bounty`;

  console.log(`  Publisher: ${pubEmail}`);
  console.log(`  Grabber:   ${grabEmail}`);

  const pubReg = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: pubEmail, name: 'PublisherAgent' }),
  });
  const pubRegData = await json(pubReg);
  const pubAgentId = pubRegData.agent_id;

  const grabReg = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: grabEmail, name: 'GrabberAgent' }),
  });
  const grabRegData = await json(grabReg);
  const grabAgentId = grabRegData.agent_id;
  console.log();

  // ===== 3. Verify Emails =====
  console.log('📋 3. Verify Emails (fetching codes from pod DB)');

  const pubCode = await getCodeFromPod(pubEmail);
  console.log(`  Publisher code: ${pubCode}`);
  const pubVerify = await api('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ email: pubEmail, code: pubCode }),
  });
  await json(pubVerify);

  const grabCode = await getCodeFromPod(grabEmail);
  console.log(`  Grabber code: ${grabCode}`);
  const grabVerify = await api('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ email: grabEmail, code: grabCode }),
  });
  await json(grabVerify);
  console.log();

  // ===== 4. Login =====
  console.log('📋 4. Login to get tokens');

  const pubLogin = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: pubEmail }),
  });
  const pubLoginData = await json(pubLogin);
  const pubToken = pubLoginData.token;

  const grabLogin = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: grabEmail }),
  });
  const grabLoginData = await json(grabLogin);
  const grabToken = grabLoginData.token;
  console.log();

  // ===== 5. Check Credits =====
  console.log('📋 5. Check initial credits');
  const pubCredits = await api('/api/agents/me/credits', {
    headers: { Authorization: `Bearer ${pubToken}` },
  });
  await json(pubCredits);

  const grabCredits = await api('/api/agents/me/credits', {
    headers: { Authorization: `Bearer ${grabToken}` },
  });
  await json(grabCredits);
  console.log();

  // ===== 6. Publish a Task =====
  console.log('📋 6. Publish a Bounty Task');
  const publish = await api('/api/tasks', {
    method: 'POST',
    headers: { Authorization: `Bearer ${pubToken}` },
    body: JSON.stringify({
      title: 'Build a hello-world API endpoint',
      description: 'Create a simple Bun HTTP server with a /hello endpoint that returns JSON',
      reward: 50,
      type: 'bounty',
    }),
  });
  const taskData = await json(publish);
  const taskId = taskData.id;
  console.log();

  // ===== 7. List Tasks (board) =====
  console.log('📋 7. List Tasks (task board)');
  const board = await api('/api/tasks', {
    headers: { Authorization: `Bearer ${grabToken}` },
  });
  await json(board);
  console.log();

  // ===== 8. Grab the Task =====
  console.log('📋 8. Grab the Task');
  const grab = await api(`/api/tasks/${taskId}/grab`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${grabToken}` },
  });
  await json(grab);
  console.log();

  // ===== 9. Check Task Status After Grab =====
  console.log('📋 9. Check Task Status');
  const taskAfterGrab = await api(`/api/tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${grabToken}` },
  });
  await json(taskAfterGrab);
  console.log();

  // ===== 10. Submit Result =====
  console.log('📋 10. Submit Result');
  const submit = await api(`/api/tasks/${taskId}/submit`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${grabToken}` },
    body: JSON.stringify({
      result: 'Created a Bun HTTP server at http://example.com/hello - returns {"message":"Hello World!"}',
    }),
  });
  await json(submit);
  console.log();

  // ===== 11. Complete the Task =====
  console.log('📋 11. Complete the Task (publisher approves)');
  const complete = await api(`/api/tasks/${taskId}/complete`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${pubToken}` },
  });
  await json(complete);
  console.log();

  // ===== 12. Final Task Status =====
  console.log('📋 12. Final Task Status');
  const finalTask = await api(`/api/tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${pubToken}` },
  });
  await json(finalTask);
  console.log();

  // ===== 13. Check Credits After Completion =====
  console.log('📋 13. Credits After Completion');
  const pubCreditsAfter = await api('/api/agents/me/credits', {
    headers: { Authorization: `Bearer ${pubToken}` },
  });
  await json(pubCreditsAfter);

  const grabCreditsAfter = await api('/api/agents/me/credits', {
    headers: { Authorization: `Bearer ${grabToken}` },
  });
  await json(grabCreditsAfter);
  console.log();

  // ===== 14. Agent Communication (IM) =====
  console.log('📋 14. Agent Communication (IM)');
  const imMsg = await api('/api/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${grabToken}` },
    body: JSON.stringify({
      to: `${pubAgentId}@authenticated`,
      content: {
        type: 'text',
        text: 'Hey publisher! Task completed. Please review my submission.',
      },
    }),
  });
  await json(imMsg);

  // Read inbox of publisher
  const inbox = await api(`/api/messages?address=${pubAgentId}@authenticated`, {
    headers: { Authorization: `Bearer ${pubToken}` },
  });
  await json(inbox);

  // Publisher replies
  const reply = await api('/api/messages', {
    method: 'POST',
    headers: { Authorization: `Bearer ${pubToken}` },
    body: JSON.stringify({
      to: `${grabAgentId}@authenticated`,
      content: {
        type: 'text',
        text: 'Great work! Task approved. Credits transferred.',
      },
    }),
  });
  await json(reply);

  // Check grabber's inbox
  const grabInbox = await api(`/api/messages?address=${grabAgentId}@authenticated`, {
    headers: { Authorization: `Bearer ${grabToken}` },
  });
  await json(grabInbox);
  console.log();

  // ===== 15. List All Agents =====
  console.log('📋 15. List All Agents');
  const agents = await api('/api/agents', {
    headers: { Authorization: `Bearer ${pubToken}` },
  });
  await json(agents);
  console.log();

  // ===== Summary =====
  console.log('='.repeat(60));
  console.log('✅ E2E TEST COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Publisher Agent ID: ${pubAgentId}`);
  console.log(`  Grabber Agent ID:   ${grabAgentId}`);
  console.log(`  Task ID:            ${taskId}`);
  console.log(`  Messages Sent:      2`);
  console.log('='.repeat(60));
}

main().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
