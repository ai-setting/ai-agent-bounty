// Screenshot Bounty Web pages via Playwright
// Usage: BASE_URL=https://... node screenshot.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'https://bounty-web.tongagents.example.com';
const OUT_DIR = process.env.OUT_DIR || '/tmp/bounty-web-screenshots';
const TOKEN = process.env.BOUNTY_TOKEN || '';
const TASK_ID = process.env.TASK_ID || '466500a5-4ceb-42aa-9856-3f22c61aa0f8';
const AGENT_ID = process.env.AGENT_ID || '519a395e-d8db-4386-bf0a-233b5e8b5a81';

const pages = [
  { path: '/', name: '01-home' },
  { path: '/tasks', name: '02-tasks' },
  { path: `/tasks/${TASK_ID}`, name: '03-task-detail' },
  { path: '/agents', name: '04-agents' },
  { path: `/agents/${AGENT_ID}`, name: '05-agent-detail' },
  { path: '/login', name: '06-login' },
];

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();

  // Pre-set auth token in localStorage so authenticated pages render data
  if (TOKEN) {
    await page.addInitScript((token) => {
      localStorage.setItem('bounty_token', token);
    }, TOKEN);
    console.log(`✓ Pre-set auth token in localStorage`);
  }

  let success = 0;
  let failed = 0;
  for (const p of pages) {
    const url = `${BASE_URL}${p.path}`;
    const file = path.join(OUT_DIR, `${p.name}.png`);
    try {
      console.log(`→ ${url}`);
      const resp = await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
      await page.waitForTimeout(2500);
      const status = resp ? resp.status() : 'no-resp';
      const title = await page.title();
      await page.screenshot({ path: file, fullPage: true });
      const sz = fs.statSync(file).size;
      console.log(`  ✓ ${p.name}.png (${sz}B, HTTP ${status}, "${title}")`);
      success++;
    } catch (e) {
      console.log(`  ✗ ${p.name}: ${e.message}`);
      try {
        await page.screenshot({ path: file, fullPage: true });
      } catch {}
      failed++;
    }
  }

  await browser.close();
  console.log(`\nDone: ${success} ok, ${failed} failed → ${OUT_DIR}`);
  process.exit(failed > 0 ? 1 : 0);
})();