// Captura del JUEGO REAL (src/main.js: createHumanView + createAnimator3D + mundo/piso real), 3 cámaras, contact sheets.
// Uso: node scripts/anim-game-capture.mjs [outDir] [escena1,escena2] [flat|world]
// Detiene el loop y avanza animadores a mano (60 Hz, determinista) con la raíz que da este script (hace de "sim").
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || '/workspace/origen-shots/anim-r2/game';
const ONLY = process.argv[3] ? process.argv[3].split(',') : null;
const FLOOR = process.argv[4] || 'flat';
fs.mkdirSync(OUT, { recursive: true });
const CAMS = ['front', 'side', 'top34'];
const W = 480, H = 400;
// acciones: { t, who: 0|1, play, opts }.  who 0 = beige (mira +X), 1 = rojo (mira -X)
const SCENES = {
  guard: { times: [1.0, 1.7, 2.4, 3.1], actions: [] },
  jab: { times: [1.40, 1.50, 1.58, 1.65, 1.75, 1.90, 2.10, 2.40], actions: [{ t: 1.5, who: 0, play: 'jab' }] },
  jabsync: { times: [1.50, 1.56, 1.60, 1.64, 1.70, 1.76, 1.82, 1.95], actions: [{ t: 1.5, who: 0, play: 'jab', opts: { impactIn: 0.10, duration: 0.32 } }, { t: 1.5, who: 1, play: 'jab', opts: { speed: 0.6 } }] },   // KAGE: impacto a 0.10 s, total 0.32 s
  cross: { times: [1.50, 1.58, 1.62, 1.65, 1.68, 1.71, 1.76, 1.90], actions: [{ t: 1.5, who: 0, play: 'cross' }] },
  hook: { times: [1.50, 1.58, 1.62, 1.65, 1.68, 1.72, 1.78, 1.95], actions: [{ t: 1.5, who: 0, play: 'hook' }] },
  block: { times: [1.0, 1.15, 1.3, 1.5, 1.6, 1.7, 2.2, 2.6], actions: [{ t: 1.1, who: 0, guard: 1 }, { t: 1.5, who: 1, play: 'jab' }, { t: 2.3, who: 0, guard: 0 }] },
  lowkick: { times: [1.50, 1.58, 1.65, 1.72, 1.78, 1.82, 1.90, 2.05, 2.20, 2.40, 2.55, 2.80], actions: [{ t: 1.5, who: 0, play: 'lowkick' }] },
};

const server = await createServer({ configFile: false, root: path.resolve('.'), server: { port: 5198, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
const sheetPage = await browser.newPage(); await sheetPage.goto('about:blank');
const save = (name, dataUrl) => fs.writeFileSync(path.join(OUT, name), Buffer.from(dataUrl.split(',')[1], 'base64'));

for (const [name, sc] of Object.entries(SCENES)) {
  if (ONLY && !ONLY.includes(name)) continue;
  await page.goto(`http://127.0.0.1:5198/?seed=1${FLOOR === 'flat' ? '&floor=flat' : '&r=2'}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ORIGEN__ && window.__ORIGEN__.ready');
  await new Promise((r) => setTimeout(r, 1500));
  const res = await page.evaluate(async (sc, cams) => {
    const G = window.__ORIGEN__; G.loop.stop();
    const { fighters, camera, renderer, world } = G; const THREE_ = camera.constructor;
    // coloca a los dos con la separación de combate sobre el suelo real
    const cx = fighters[0].root.pos[0] + 0.7, cz = fighters[0].root.pos[2], gy = fighters[0].root.pos[1];
    const sep = 0.62; fighters[0].root.pos = [cx - sep, gy, cz]; fighters[1].root.pos = [cx + sep, gy, cz];
    fighters[0].root.yaw = 0; fighters[1].root.yaw = Math.PI;
    const dt = 1 / 60, out = {}; for (const c of cams) out[c] = [];
    const times = sc.times, last = Math.max(...times);
    const acts = sc.actions.slice(); let ti = 0;
    renderer.setSize(480, 400); camera.aspect = 480 / 400; camera.updateProjectionMatrix();
    const target = [cx, gy + 0.95, cz];
    const camDef = { front: [cx - 1.3, gy + 1.15, cz + 3.0], side: [cx, gy + 1.1, cz - 3.0], top34: [cx - 1.5, gy + 2.5, cz - 2.2] };   // front = 3/4 por el lado derecho de beige
    for (let i = 0; i * dt <= last + 1e-6; i++) {
      const t = i * dt;
      while (acts.length && acts[0].t <= t + 1e-9) { const a = acts.shift(); if (a.play) fighters[a.who].anim.play(a.play, a.opts); if (a.guard !== undefined) fighters[a.who].anim.setGuardLevel(a.guard); }
      for (const f of fighters) f.anim.update(dt, f.root);
      if (ti < times.length && Math.abs(t - times[ti]) < dt / 2) {
        for (const f of fighters) f.view.update(f.anim.skeleton);
        for (const c of cams) { camera.position.set(...camDef[c]); camera.lookAt(...target); camera.fov = 32; camera.updateProjectionMatrix(); renderer.render(G.scene, camera); out[c].push(renderer.domElement.toDataURL('image/png')); }
        ti++;
      }
    }
    return out;
  }, sc, CAMS);
  const mk = (camList, perRow, scale, label) => sheetPage.evaluate(async (res, times, cams, perRow, cw, ch, label) => {
    const rowsPer = Math.ceil(times.length / perRow);
    const cv = document.createElement('canvas'); cv.width = cw * perRow; cv.height = 22 + ch * rowsPer * cams.length; const g = cv.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, cv.width, cv.height); g.font = '14px monospace'; g.fillStyle = '#9fb0d0'; g.fillText(label, 6, 15);
    for (let r = 0; r < cams.length; r++) for (let k = 0; k < times.length; k++) {
      const img = new Image(); img.src = res[cams[r]][k]; await img.decode();
      const col = k % perRow, row = r * rowsPer + Math.floor(k / perRow);
      g.drawImage(img, col * cw, 22 + row * ch, cw, ch); g.fillStyle = '#ffd24d'; g.fillText(cams[r] + ' t=' + times[k].toFixed(2), col * cw + 6, 22 + row * ch + 16);
    }
    return cv.toDataURL('image/png');
  }, res, sc.times, camList, perRow, Math.round(W * scale), Math.round(H * scale), label);
  save(`game_${name}.png`, await mk(CAMS, Math.min(4, sc.times.length), 0.8, `JUEGO REAL ${name} (${FLOOR}) filas: ${CAMS.join(' / ')}`));
  for (const c of CAMS) { save(`game_${name}_${c}.png`, await mk([c], 4, 1.0, `JUEGO REAL ${name} cam ${c}`)); }
  console.log('ok', name);
}
await browser.close(); await server.close();
