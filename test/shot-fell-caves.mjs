// Capturas a nivel del suelo (cámara a 1,6 m): árbol cayendo (frames), madera en el suelo, boca de cueva e interior con carbón/hierro.
// Uso: node test/shot-fell-caves.mjs   (usa el dev server de vite en :5193 + Chrome SwiftShader; con lock de smokes; mata todo al salir)
// Env: OUT (carpeta, default /workspace/origen-shots/world-fell-caves), SEEDN (1234), ONLY=tree|mouth|cave, MOUTH (índice), CAVE (índice)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { acquireSmokeLock } from './smokeLock.mjs';
import { World, listTrees, B, BLOCK_SIZE_M as S } from '../src/world/index.js';
import { columnInfo, SPECIES_NAMES, listCaveEntrances } from '../src/world/generator.js';
import { IS_SOLID } from '../src/world/blocks.js';
const OUT = process.env.OUT || '/workspace/origen-shots/world-fell-caves', port = 5193, seed = Number(process.env.SEEDN ?? 1234), ONLY = process.env.ONLY;
mkdirSync(OUT, { recursive: true });
const EYE = 1.6;

// ---- escenas (cálculo en node con el mismo World/seed) ----
const trees = listTrees(seed, -200, -200, 200, 200);
const tcand = trees.filter((t) => SPECIES_NAMES[t.species] === 'oak' && t.height >= 11 && !trees.some((o) => o !== t && Math.hypot(o.x - t.x, o.z - t.z) < 14)).filter((t) => {
  for (let dx = -10; dx <= 12; dx += 2) for (let dz = -10; dz <= 26; dz += 2) if (Math.abs(columnInfo(seed, t.x + dx, t.z + dz).height - t.ground) > 1) return false; return true; });
const T = tcand[Number(process.env.TREE ?? 3)] ?? tcand[0];

const w = new World(seed);
const ents = listCaveEntrances(seed, -128, -128, 127, 127);
function mouthShot(e) {
  const l = Math.hypot(e.dirX, e.dirZ), ux = e.dirX / l, uz = e.dirZ / l, back = Number(process.env.BACK ?? 11);
  let cx = Math.round(e.x - ux * back), cz = Math.round(e.z - uz * back);
  const ch = w.surfaceY(cx, cz);
  return { eye: [(cx + 0.5) * S, (ch + 1) * S + EYE, (cz + 0.5) * S], at: [(e.x + ux * 2 + 0.5) * S, (e.h - 1.5) * S, (e.z + uz * 2 + 0.5) * S], e };
}
function caveShot() {
  // posición de pie (4 de aire libre, suelo sólido) con hierro y carbón expuestos a la vista (rayo despejado) a 2..9 bloques
  const open = (x, y, z) => !IS_SOLID[w.getBlock(x, y, z)];
  const exposed = (x, y, z) => [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([a, b, c]) => open(x + a, y + b, z + c));
  const los = (a, b) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * 3); for (let i = 1; i < n - 1; i++) { const t = i / n; if (IS_SOLID[w.getBlock(Math.floor(a[0] + (b[0] - a[0]) * t), Math.floor(a[1] + (b[1] - a[1]) * t), Math.floor(a[2] + (b[2] - a[2]) * t))]) return false; } return true; };
  const best = [];
  for (let cz = -7; cz < 7; cz++) for (let cx = -7; cx < 7; cx++) w.chunk(cx, cz);
  for (let X = -100; X < 100; X += 1) for (let Z = -100; Z < 100; Z += 1) for (let Y = 6; Y < 40; Y++) {
    if (!(IS_SOLID[w.getBlock(X, Y - 1, Z)] && open(X, Y, Z) && open(X, Y + 1, Z) && open(X, Y + 2, Z) && open(X, Y + 3, Z) && open(X, Y + 4, Z))) continue;
    if (w.getBlock(X, w.surfaceY(X, Z), Z) === B.WATER) continue;
    if (Y + 4 > w.surfaceY(X, Z) - 2) continue;                                   // bajo tierra de verdad
    const eye = [X + 0.5, Y + 1.6 / S, Z + 0.5];
    let iron = null, coal = null, ni = 0, nc = 0;
    for (let dx = -9; dx <= 9; dx++) for (let dz = -9; dz <= 9; dz++) for (let dy = -2; dy <= 5; dy++) {
      const id = w.getBlock(X + dx, Y + dy, Z + dz); if (id !== B.IRON && id !== B.COAL) continue;
      const d = Math.hypot(dx, dy, dz); if (d < 2.5 || !exposed(X + dx, Y + dy, Z + dz)) continue;
      if (!los(eye, [X + dx + 0.5, Y + dy + 0.5, Z + dz + 0.5])) continue;
      if (id === B.IRON) { ni++; if (!iron || d < iron.d) iron = { d, p: [X + dx, Y + dy, Z + dz] }; } else { nc++; if (!coal || d < coal.d) coal = { d, p: [X + dx, Y + dy, Z + dz] }; }
    }
    if (iron && coal && ni >= Number(process.env.NI ?? 1) && nc >= Number(process.env.NC ?? 2)) best.push({ X, Y, Z, ni, nc, iron, coal, score: ni * 3 + nc });
  }
  best.sort((a, b) => b.score - a.score);
  const b = best[Number(process.env.CAVE ?? 0)]; if (!b) throw new Error('sin cueva con carbón y hierro a la vista');
  const mid = [(b.iron.p[0] + b.coal.p[0]) / 2 + 0.5, (b.iron.p[1] + b.coal.p[1]) / 2 + 0.5, (b.iron.p[2] + b.coal.p[2]) / 2 + 0.5];
  return { eye: [(b.X + 0.5) * S, (b.Y) * S + EYE, (b.Z + 0.5) * S], at: mid.map((v) => v * S), b, count: best.length };
}

const release = await acquireSmokeLock();
const srv = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore', detached: true });
const browser0 = [];
let code = 0;
const cleanup = async () => { for (const b of browser0) try { await b.close(); } catch {} try { process.kill(-srv.pid); } catch {} release(); };
try {
  await new Promise((r) => setTimeout(r, 3500));
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1280,720'] });
  browser0.push(browser);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${port}/?seed=${seed}&r=5`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ORIGEN__?.ready, { timeout: 30000 });
  await page.addScriptTag({ type: 'module', url: '/test/shot-fell-page.js' });
  await page.waitForFunction(() => window.__FELL_READY__, { timeout: 30000 });
  const same = await page.evaluate(() => ({ seed: window.__FELL__.seed, ws: window.__FELL__.worldSeed }));
  console.log('page seeds', same);
  const frame = (p) => page.evaluate((q) => window.__FELL__.frame(q), p);
  const shot = async (name, p) => { const info = await frame(p); await page.screenshot({ path: `${OUT}/${name}.png` }); console.log(name, JSON.stringify(info)); };
  const info = {};

  if (!ONLY || ONLY === 'tree') {
    // árbol: cámara al sur (+z) a 12 m mirando al norte; cae hacia +x (a la derecha de la imagen)
    const tx = T.x + 0.5, tz = T.z + 0.5, gy = (T.ground + 1) * S;
    const cam = { eye: [tx * S - 0.5, gy + EYE, (tz + 17) * S], at: [tx * S + 1.2, gy + 2.2, tz * S], fov: 62 };
    console.log('árbol', JSON.stringify({ x: T.x, z: T.z, ground: T.ground, height: T.height, species: SPECIES_NAMES[T.species] }));
    await shot('tree-0-antes', cam);
    await page.evaluate((a) => { const W = window.__FELL__.world; window.__FELL__.r = W.fellTree(a.x, a.y, a.z, { dirX: 1, dirZ: 0 }); }, { x: T.x, y: T.ground + 1, z: T.z });
    const marks = [0.3, 0.8, 1.3];
    for (let i = 0; i < marks.length; i++) {
      await page.evaluate((th) => { const W = window.__FELL__.world; let n = 0; while (W.fallingTrees.length && W.fallingTrees[0].theta < th && n < 5000) { W.stepEntities(1); n++; } }, marks[i]);
      const th = await page.evaluate(() => window.__FELL__.world.fallingTrees[0]?.theta ?? null);
      await shot(`tree-${i + 1}-cayendo-th${th === null ? 'impacto' : th.toFixed(2)}`, cam);
    }
    await page.evaluate(() => { const W = window.__FELL__.world; let n = 0; while (W.fallingTrees.length && n < 5000) { W.stepEntities(1); n++; } for (let i = 0; i < 400; i++) W.stepEntities(1); });
    await shot('tree-5-madera-en-el-suelo', cam);
    const items = await page.evaluate(() => window.__FELL__.world.itemDrops.map((i) => [i.id, +(i.x / 0.5).toFixed(2), +(i.y / 0.5).toFixed(2), +(i.z / 0.5).toFixed(2)]));
    console.log('items', items.length, JSON.stringify(items.slice(0, 4)));
    // plano cercano: de pie junto a los troncos (a 3 m), mirando al suelo-horizonte
    const it0 = items[Math.floor(items.length / 2)];
    await shot('tree-6-madera-cerca', { eye: [(it0[1] - 5) * S, gy + EYE, (it0[3] + 9) * S], at: [it0[1] * S, gy + 0.2, it0[3] * S], fov: 62 });
    info.tree = { x: T.x, z: T.z, items: items.length };
  }
  if (!ONLY || ONLY === 'mouth') {
    const idx = Number(process.env.MOUTH ?? 0), list = process.env.MOUTH_LIST ? process.env.MOUTH_LIST.split(',').map(Number) : [idx];
    for (const i of list) { const m = mouthShot(ents[i]); console.log('boca', i, JSON.stringify({ x: m.e.x, z: m.e.z, h: m.e.h, bottomY: m.e.bottomY })); await shot(`cave-mouth-${i}`, { ...m, fov: 66 }); }
  }
  if (!ONLY || ONLY === 'cave') {
    const c = caveShot(); console.log('cueva', JSON.stringify({ X: c.b.X, Y: c.b.Y, Z: c.b.Z, ni: c.b.ni, nc: c.b.nc, candidates: c.count }));
    await shot('cave-interior-carbon-hierro', { eye: c.eye, at: c.at, fov: 70 });
  }
  console.log('errors', JSON.stringify(errors));
  if (errors.length) code = 1;
} catch (e) { console.error(e); code = 1; } finally { await cleanup(); }
process.exit(code);
