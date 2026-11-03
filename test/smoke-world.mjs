// Mide el mundo cargado en Chrome headless (SwiftShader = render por SOFTWARE, no GPU). Uso: npm run build && npm run smoke:world
// Env: R (radio en chunks, 4.5 ≈ 8x8), SECS (duración de la muestra), SHOT (png), SEEDN.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
const port = 5191, R = process.env.R ?? '4.5', SECS = Number(process.env.SECS ?? 8);
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720'] });
let code = 0;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/?seed=${process.env.SEEDN ?? 1}&r=${R}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ORIGEN__?.ready, { timeout: 15000 });
  await page.waitForFunction(() => { const v = window.__ORIGEN__.view.stats(); return v.chunks > 0 && v.pendingMesh === 0; }, { timeout: 120000, polling: 100 });
  const loadMs = Date.now() - t0;
  const res = await page.evaluate((secs) => new Promise((resolve) => {
    const O = window.__ORIGEN__, dts = []; let last = performance.now(); const start = last;
    function f(now) {
      dts.push(now - last); last = now;
      if (now - start < secs * 1000) return requestAnimationFrame(f);
      const win = []; let acc = 0, n = 0; // fps por ventanas de 0.5 s
      for (const d of dts) { acc += d; n++; if (acc >= 500) { win.push(n * 1000 / acc); acc = 0; n = 0; } }
      const total = dts.reduce((a, b) => a + b, 0);
      const info = O.renderer.info;
      resolve({ frames: dts.length, avgFps: dts.length * 1000 / total, minFps500ms: Math.min(...win), worstFrameMs: Math.max(...dts), medianFrameMs: [...dts].sort((a, b) => a - b)[dts.length >> 1],
        drawCalls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures,
        view: O.view.stats(), missingTiles: O.view.missingTiles, grid: O.view.grid, tileAtlas: O.renderer.getContext().getParameter(O.renderer.getContext().VERSION) });
    }
    requestAnimationFrame(f);
  }), SECS);
  // El rAF de Chrome headless está topado a 60 Hz: para ver el margen real se cronometran N renders seguidos con readPixels(1x1) para forzar la sincronía con la GPU/SwiftShader.
  const raw = await page.evaluate((N) => { const O = window.__ORIGEN__, gl = O.renderer.getContext(), ts = [], px = new Uint8Array(4);
    for (let i = 0; i < 10; i++) O.renderer.render(O.scene, O.camera);
    for (let i = 0; i < N; i++) { const a = performance.now(); O.renderer.render(O.scene, O.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); ts.push(performance.now() - a); }
    ts.sort((a, b) => a - b); const mean = ts.reduce((a, b) => a + b, 0) / N;
    return { N, meanMs: mean, medianMs: ts[N >> 1], p95Ms: ts[Math.floor(N * 0.95)], maxMs: ts[N - 1], uncappedFpsFromMean: 1000 / mean, drawCalls: O.renderer.info.render.calls, triangles: O.renderer.info.render.triangles }; }, 200);
  res.rawRender = raw;
  await page.screenshot({ path: process.env.SHOT || 'shots/smoke-world.png' });
  console.log(JSON.stringify({ R, loadMs, ...res, errors }, null, 1));
  if (errors.length || res.view.chunks < 1) code = 1;
} finally { await browser.close(); srv.kill(); }
process.exit(code);
