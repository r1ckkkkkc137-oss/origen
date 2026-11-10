// Prueba jugable en Chrome headless: cavar, poner, talar (árbol que cae + items) y controles táctiles. Uso: npm run build && node test/smoke-play.mjs
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { acquireSmokeLock } from './smokeLock.mjs';
import { mkdirSync } from 'node:fs';
mkdirSync('shots', { recursive: true });
await acquireSmokeLock();
const port = 5193, SEED = process.env.SEEDN ?? 1;
const srv = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { stdio: 'ignore', detached: true });
await new Promise((r) => setTimeout(r, 2500));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {}; const errors = []; let code = 0;
async function open(q, touch = false) {
  const page = await browser.newPage();
  await page.setViewport({ width: touch ? 900 : 1280, height: touch ? 420 : 720, hasTouch: touch, isMobile: touch });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${port}/?seed=${SEED}&${q}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ORIGEN__?.ready, { timeout: 15000 });
  await page.waitForFunction(() => { const v = window.__ORIGEN__.view.stats(); return v.chunks > 0 && v.pendingMesh === 0; }, { timeout: 120000, polling: 200 });
  await sleep(800);
  return page;
}
const until = (page, fn, arg, ms = 15000) => page.waitForFunction(fn, { timeout: ms, polling: 50 }, arg);
try {
  // --- cavar y poner en primera persona ---
  let page = await open('cam=p1');
  const dig = await page.evaluate(() => {
    const O = window.__ORIGEN__; O.rig.setLook(0, -1.45);
    return new Promise((res) => setTimeout(() => {
      const a = O.act.aim; if (!a) return res({ err: 'sin aim' });
      const before = O.world.getBlock(...a.pos); O.input.setVirtual('Dig', true);
      const t0 = performance.now();
      (function w() { if (!O.world.getBlock(...a.pos) || performance.now() - t0 > 8000) { O.input.setVirtual('Dig', false); res({ pos: a.pos, before, after: O.world.getBlock(...a.pos), ms: Math.round(performance.now() - t0) }); } else setTimeout(w, 30); })();
    }, 300));
  });
  out.dig = dig;
  if (!dig.before || dig.after !== 0) throw new Error('cavar falló ' + JSON.stringify(dig));
  await sleep(600);
  const place = await page.evaluate(() => {
    const O = window.__ORIGEN__; O.rig.setLook(Math.PI / 2, -0.75);
    return new Promise((res) => setTimeout(() => {
      const a = O.act.aim, id = O.act.selected, n = O.act.inv.get(id); if (!a) return res({ err: 'sin aim' });
      O.input.setVirtual('Place', true);
      setTimeout(() => { O.input.setVirtual('Place', false); res({ cell: a.place, id, got: O.world.getBlock(...a.place), invBefore: n, invAfter: O.act.inv.get(id) }); }, 120);
    }, 300));
  });
  out.place = place;
  if (place.got !== place.id || place.invAfter !== place.invBefore - 1) throw new Error('poner falló ' + JSON.stringify(place));
  await page.screenshot({ path: 'shots/play-dig-place.png' });
  // --- talar: busca un tronco, se para al lado mirándolo ---
  const fell = await page.evaluate(() => {
    const O = window.__ORIGEN__, W = O.world, M = 0.5, p = O.player;
    const px = Math.floor(p.x / M), pz = Math.floor(p.z / M);
    const LOGS = new Set([6, 13, 15]);
    let best = null;
    for (let r = 2; r < 40 && !best; r++) for (let dx = -r; dx <= r && !best; dx++) for (const dz of [-r, r]) {
      const x = px + dx, z = pz + dz, top = W.surfaceY(x, z);
      for (let y = top; y > 1; y--) if (LOGS.has(W.getBlock(x, y, z)) && !LOGS.has(W.getBlock(x, y - 1, z)) && W.getBlock(x, y - 1, z) && !W.getBlock(x - 2, y, z) && !W.getBlock(x - 2, y + 1, z) && !W.getBlock(x - 2, y + 2, z) && !W.getBlock(x - 2, y + 3, z) && W.getBlock(x - 2, y - 1, z)) { best = [x, y, z]; break; }
    }
    if (!best) return { err: 'sin árbol' };
    const [x, y, z] = best;
    p.x = (x - 1.5) * M; p.y = y * M; p.z = (z + 0.5) * M; p.vx = p.vy = p.vz = 0;
    const aimAt = () => { const e = O.camera.position, dx = (x + 0.5) * M - e.x, dy = (y + 0.5) * M - e.y, dz = (z + 0.5) * M - e.z;
      O.rig.setLook(Math.atan2(-dx, -dz), Math.asin(dy / Math.hypot(dx, dy, dz))); };
    aimAt();
    return new Promise((res) => setTimeout(() => {
      aimAt(); const a = O.act.aim; O.input.setVirtual('Dig', true); const t0 = performance.now();
      (function w() { aimAt();
        if (W.fallingTrees.length || performance.now() - t0 > 10000) { O.input.setVirtual('Dig', false); res({ log: best, aim: a?.pos, trees: W.fallingTrees.length, ms: Math.round(performance.now() - t0) }); }
        else setTimeout(w, 30);
      })();
    }, 400));
  });
  out.fell = fell;
  if (!fell.trees) throw new Error('talar falló ' + JSON.stringify(fell));
  await sleep(500); await page.screenshot({ path: 'shots/play-fell-mid.png' });
  await until(page, () => window.__ORIGEN__.world.fallingTrees.length === 0, null, 20000);
  out.fell.drops = await page.evaluate(() => window.__ORIGEN__.world.itemDrops.length);
  await sleep(400); await page.screenshot({ path: 'shots/play-fell-after.png' });
  await page.close();
  // --- táctil ---
  page = await open('cam=p3&touch=1', true);
  out.touch = await page.evaluate(() => ({ ui: !!document.getElementById('touch-ui'), buttons: [...document.querySelectorAll('#touch-ui [data-code]')].map((b) => b.dataset.code) }));
  const btn = await page.$('#touch-ui [data-code="Dig"]'); const bb = await btn.boundingBox();
  await page.touchscreen.touchStart(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await sleep(150);
  out.touch.digHeld = await page.evaluate(() => window.__ORIGEN__.input.down('Dig'));
  await page.touchscreen.touchEnd();
  await sleep(100);
  out.touch.digReleased = !(await page.evaluate(() => window.__ORIGEN__.input.down('Dig')));
  const p0 = await page.evaluate(() => [window.__ORIGEN__.player.x, window.__ORIGEN__.player.z]);
  await page.touchscreen.touchStart(150, 300); await page.touchscreen.touchMove(150, 240);
  await sleep(1000);
  await page.screenshot({ path: 'shots/play-touch.png' });
  await page.touchscreen.touchEnd();
  const p1 = await page.evaluate(() => [window.__ORIGEN__.player.x, window.__ORIGEN__.player.z]);
  out.touch.stickMovedM = +Math.hypot(p1[0] - p0[0], p1[1] - p0[1]).toFixed(2);
  if (!out.touch.ui || !out.touch.digHeld || !out.touch.digReleased || out.touch.stickMovedM < 0.5) throw new Error('táctil falló ' + JSON.stringify(out.touch));
  await page.close();
} catch (e) { code = 1; out.error = String(e.message ?? e); }
out.errors = errors;
if (errors.length) code = 1;
console.log(JSON.stringify(out, null, 1));
await browser.close();
try { process.kill(-srv.pid); } catch {}
process.exit(code);
