// Test de carga en Chrome headless (SwiftShader, sin GPU). Uso: npm run build && npm run smoke
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:net';
import { acquireSmokeLock } from './smokeLock.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('shots', { recursive: true });
await acquireSmokeLock();
// puerto libre (otro agente puede tener un preview colgado en 5190 y mediríamos SU build)
const port = Number(process.env.PORT) || await new Promise((r) => { const s = createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 2500));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720'] });
let code = 0;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${port}/?seed=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ORIGEN__?.ready, { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 4000));
  const fps = await page.evaluate(() => window.__ORIGEN__.fps.fps);
  const tick = await page.evaluate(() => window.__ORIGEN__.loop.tick);
  const cpu = await page.evaluate(() => window.__ORIGEN__.loop.cpu.stats());
  await page.screenshot({ path: process.env.SHOT || 'shots/smoke.png' });
  console.log(JSON.stringify({ fps: +fps.toFixed(1), tick, cpu, errors }));
  if (errors.length || tick < 60) code = 1;
} finally { await browser.close(); try { process.kill(-srv.pid); } catch {} }
process.exit(code);
