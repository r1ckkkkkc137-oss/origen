// Captura de árboles a nivel del suelo en Chrome headless (SwiftShader = software). Uso: npm run build && node test/shot-trees.mjs
// Env: MINH (altura mínima del foco), ROOTS=1 (foco con raíces), BASE=1 (mira a la base del tronco), SEEDN (default 1234), SHOT (png), SPECIES=oak|pine|birch (especie del árbol foco, default oak), IDX (n-ésimo grupo candidato), DIST (bloques, default 13).
// No toca main.js: para el loop del motor, coloca la cámara con window.__ORIGEN__ y renderiza a mano.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';
import { listTrees, columnInfo, SPECIES_NAMES } from '../src/world/generator.js';
const port = 5192, seed = Number(process.env.SEEDN ?? 1234), want = process.env.SPECIES ?? 'oak', BM = 0.5;
const trees = listTrees(seed, -240, -240, 240, 240);
// foco: árbol de la especie pedida con ≥4 vecinos (2+ especies distintas) a ≤16 bloques y terreno liso alrededor
const cands = trees.filter((t) => SPECIES_NAMES[t.species] === want && t.height >= Number(process.env.MINH ?? 12) && (!process.env.ROOTS || t.roots.length > 0)).map((t) => {
  const nb = trees.filter((o) => o !== t && Math.hypot(o.x - t.x, o.z - t.z) <= 16);
  return { t, nb, kinds: new Set(nb.map((o) => o.species)).size };
}).filter((c) => c.nb.length >= 4 && c.kinds >= 2).sort((a, b) => (b.kinds - a.kinds) || (b.nb.length - a.nb.length));
if (!cands.length) { console.error('sin grupo de árboles adecuado'); process.exit(2); }
const { t } = cands[Number(process.env.IDX ?? 0)];
// cámara: punto a 10..24 bloques del foco, en terreno liso y fuera del alcance de TODA copa (distancia ≥ r+2 a cualquier árbol)
let cam = null;
const want0 = Number(process.env.DIST ?? 14);
for (let d = want0; d <= 26 && !cam; d += 2) for (let k = 0; k < 16 && !cam; k++) {
  const a = (k / 16) * Math.PI * 2, x = Math.round(t.x + Math.cos(a) * d), z = Math.round(t.z + Math.sin(a) * d);
  if (trees.some((o) => Math.max(Math.abs(o.x - x), Math.abs(o.z - z)) < o.r + 3)) continue;
  const h = columnInfo(seed, x, z).height;
  if (h < 22 || [[2, 0], [-2, 0], [0, 2], [0, -2]].some(([dx, dz]) => Math.abs(columnInfo(seed, x + dx, z + dz).height - h) > 1)) continue;
  cam = { x: x + 0.5, z: z + 0.5, h };
}
if (!cam) { console.error('sin punto de cámara libre'); process.exit(2); }
const cx = cam.x, cz = cam.z, eye = (cam.h + 1) * BM + 1.6;
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
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  await page.goto(`http://localhost:${port}/?seed=${seed}&r=5`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ORIGEN__?.ready, { timeout: 15000 });
  const info = await page.evaluate(async (p) => {
    const O = window.__ORIGEN__; O.loop.stop();
    O.camera.position.set(p.x * p.bm, p.eye, p.z * p.bm);
    O.camera.lookAt(p.tx * p.bm, p.ty * p.bm, p.tz * p.bm);
    O.camera.updateMatrixWorld();
    for (let i = 0; i < 400; i++) { O.view.update(O.camera.position.x, O.camera.position.z); const s = O.view.stats(); if (s.chunks > 20 && s.pendingMesh === 0 && i > 20) break; await new Promise((r) => setTimeout(r, 10)); }
    for (const f of O.fighters) f.view.group.visible = false;
    O.renderer.render(O.scene, O.camera);
    return { stats: O.view.stats(), calls: O.renderer.info.render.calls, tris: O.renderer.info.render.triangles, gl: O.renderer.getContext().getParameter(O.renderer.getContext().VERSION) };
  }, { x: cx, z: cz, eye, bm: BM, tx: t.x + 0.5, ty: t.ground + (process.env.BASE ? 4 : t.height * 0.45), tz: t.z + 0.5 });
  await page.screenshot({ path: process.env.SHOT || 'shots/trees.png' });
  console.log(JSON.stringify({ seed, focus: { species: want, x: t.x, z: t.z, height: t.height }, ...info, errors }, null, 1));
  if (errors.length) code = 1;
} finally { await browser.close(); try { process.kill(-srv.pid); } catch {} }
process.exit(code);
