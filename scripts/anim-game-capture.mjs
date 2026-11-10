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
const CAMS_TOP = ['front', 'side', 'top34', 'overhead'];
const W = 480, H = 400;
// acciones: { t, who: 0|1, play, opts }.  who 0 = beige (mira +X), 1 = rojo (mira -X)
const SCENES = {
  guard: { times: [1.0, 1.7, 2.4, 3.1], actions: [] },
  // ronda 5: Combate lanza jab/cross a ~0,95 m y separa >= 0,80 m fuera del clinch
  jab: { sep: 0.475, times: [1.50, 1.55, 1.5667, 1.60, 1.6417, 1.70, 1.76, 1.82], actions: [{ t: 1.5, who: 0, play: 'jab' }] },
  jabsync: { times: [1.50, 1.56, 1.60, 1.64, 1.70, 1.76, 1.82, 1.95], actions: [{ t: 1.5, who: 0, play: 'jab', opts: { impactIn: 0.10, duration: 0.32 } }, { t: 1.5, who: 1, play: 'jab', opts: { speed: 0.6 } }] },   // KAGE: impacto a 0.10 s, total 0.32 s
  cross: { sep: 0.475, times: [1.50, 1.567, 1.60, 1.65, 1.6917, 1.75, 1.82, 1.93], actions: [{ t: 1.5, who: 0, play: 'cross' }] },
  // ronda 4: tiempos de la sim; sep = media distancia pelvis-pelvis (el alcance de reach3d: gancho 0.70, low kick 1.00)
  hook: { sep: 0.40, times: [1.50, 1.55, 1.62, 1.6833, 1.7333, 1.78, 1.86, 1.98], actions: [{ t: 1.5, who: 0, play: 'hook' }] },
  ko: { sep: 0.45, times: [1.48, 1.62, 1.72, 1.82, 1.92, 2.10, 2.34, 2.90], actions: [{ t: 1.5, who: 1, play: 'hook' }, { t: 1.5 + 11 / 60, who: 0, play: 'ko', opts: { force: true } }] },
  feint_hook: { sep: 0.45, times: [1.50, 1.53, 1.56, 1.60, 1.63, 1.68, 1.75, 1.88], actions: [{ t: 1.5, who: 0, play: 'feint_hook' }] },
  block: { times: [1.0, 1.15, 1.3, 1.5, 1.6, 1.7, 2.2, 2.6], actions: [{ t: 1.1, who: 0, guard: 1 }, { t: 1.5, who: 1, play: 'jab' }, { t: 2.3, who: 0, guard: 0 }] },
  // ronda 6: contacto (animadores enlazados con setOpponent) a las distancias de conexión de combat-gap; el rival recibe state.hurt {zone, age, power}
  jab_contact: { link: true, sep: 0.485, times: [1.50, 1.567, 1.5833, 1.60, 1.6167, 1.6417, 1.70, 1.80], actions: [{ t: 1.5, who: 0, play: 'jab' }, { t: 1.6, who: 1, hurt: { zone: 'head', power: 0.6 } }] },
  cross_contact: { link: true, sep: 0.475, times: [1.50, 1.60, 1.6333, 1.65, 1.6667, 1.6917, 1.75, 1.90], actions: [{ t: 1.5, who: 0, play: 'cross' }, { t: 1.65, who: 1, hurt: { zone: 'head', power: 0.7 } }] },
  hook_contact: { link: true, sep: 0.425, times: [1.50, 1.60, 1.65, 1.6833, 1.70, 1.725, 1.80, 1.95], actions: [{ t: 1.5, who: 0, play: 'hook' }, { t: 1.6833, who: 1, hurt: { zone: 'head', power: 0.8 } }] },
  lowkick_contact: { link: true, sep: 0.50, times: [1.50, 1.65, 1.70, 1.7333, 1.75, 1.7833, 1.86, 2.05], actions: [{ t: 1.5, who: 0, play: 'lowkick' }, { t: 1.7333, who: 1, hurt: { zone: 'legs', power: 0.7 } }] },
  // ronda 7: patadas media/alta con clip propio a la distancia de conexión (DUEL_DIST), bloqueo (evento `block` de la sim: strikeBlocked +
  // blockHit, sin hurt) frente a no bloqueado, y ground and pound en mount (stance groundTop/groundBottom, raíces juntas, yaws opuestos)
  bodykick_contact: { link: true, sep: 0.475, times: [1.50, 1.62, 1.70, 1.7667, 1.7833, 1.8083, 1.92, 2.10], actions: [{ t: 1.5, who: 0, play: 'bodykick' }, { t: 1.7667, who: 1, hurt: { zone: 'body', power: 0.7 } }] },
  highkick_contact: { link: true, sep: 0.50, times: [1.50, 1.64, 1.75, 1.8167, 1.8333, 1.8583, 1.97, 2.15], actions: [{ t: 1.5, who: 0, play: 'highkick' }, { t: 1.8167, who: 1, hurt: { zone: 'head', power: 0.8 } }] },
  jab_blocked: { link: true, sep: 0.485, times: [1.50, 1.567, 1.5833, 1.60, 1.6167, 1.6417, 1.70, 1.80], actions: [{ t: 1.5, who: 0, play: 'jab' }, { t: 1.6, who: 0, block: { src: 'block', power: 0.6 } }] },
  jab_unblocked: { link: true, sep: 0.485, times: [1.50, 1.567, 1.5833, 1.60, 1.6167, 1.6417, 1.70, 1.80], actions: [{ t: 1.5, who: 0, play: 'jab' }, { t: 1.6, who: 1, hurt: { zone: 'head', power: 0.6 } }] },
  gnp_mount: { link: true, sep: 0, ground: 'mount', times: [1.40, 1.55, 1.633, 1.65, 1.70, 1.75, 1.83, 1.95], actions: [{ t: 1.5, who: 0, play: 'gnp_punch' }, { t: 1.65, who: 1, hurt: { zone: 'head', power: 0.7 } }] },
  gnp_mount_elbow: { link: true, sep: 0, ground: 'mount', times: [1.40, 1.58, 1.667, 1.683, 1.73, 1.78, 1.86, 1.98], actions: [{ t: 1.5, who: 0, play: 'gnp_elbow' }, { t: 1.6833, who: 1, hurt: { zone: 'head', power: 0.7 } }] },
  lowkick: { sep: 0.50, times: [1.50, 1.56, 1.64, 1.7333, 1.7667, 1.86, 1.96, 2.10], actions: [{ t: 1.5, who: 0, play: 'lowkick' }] },
  // ronda 8: codo desde la guardia, patada atrapada, chequeo, patada media con cámara cenital
  gnp_guard_elbow: { link: true, sep: 0, ground: 'guard', times: [1.40, 1.58, 1.667, 1.683, 1.73, 1.78, 1.86, 1.98], actions: [{ t: 1.5, who: 0, play: 'gnp_elbow' }, { t: 1.6833, who: 1, hurt: { zone: 'head', power: 0.7 } }] },
  bodykick_caught: { link: true, sep: 0.475, times: [1.50, 1.62, 1.733, 1.7667, 1.92, 2.07, 2.22, 2.45], actions: [{ t: 1.5, who: 0, play: 'bodykick' }, { t: 1.5 + 16 / 60, who: 0, block: { src: 'catch', guard: { limb: 'glove', side: 'L' }, power: 0.7 } }] },
  lowkick_check: { link: true, sep: 0.50, times: [1.50, 1.65, 1.70, 1.7333, 1.7583, 1.80, 1.90, 2.05], actions: [{ t: 1.5, who: 0, play: 'lowkick' }, { t: 1.5 + 14 / 60, who: 0, block: { src: 'check', guard: { limb: 'shin', side: 'L' }, power: 0.6 } }] },
};


const PORT = +process.env.PORT || (5300 + (process.pid % 600));   // puerto libre; sin servidores colgados al terminar (server.close)
const server = await createServer({ configFile: false, root: path.resolve('.'), server: { port: PORT, host: '127.0.0.1' }, logLevel: 'error' });
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
  const cams = (name === 'bodykick_contact' || name === 'bodykick_caught' || sc.overhead) ? CAMS_TOP : CAMS;
  await page.goto(`http://127.0.0.1:${PORT}/?seed=1${FLOOR === 'flat' ? '&floor=flat&adapt=0' : '&r=2&adapt=0'}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ORIGEN__ && window.__ORIGEN__.ready', { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 1500));
  const res = await page.evaluate(async (sc, cams) => {
    const G = window.__ORIGEN__; G.loop.stop();
    const { fighters, camera, renderer, world } = G; const THREE_ = camera.constructor;
    // coloca a los dos con la separación de combate sobre el suelo real
    const cx = fighters[0].root.pos[0] + 0.7, cz = fighters[0].root.pos[2], gy = fighters[0].root.pos[1];
    const sep = sc.sep ?? 0.62; fighters[0].root.pos = [cx - sep, gy, cz]; fighters[1].root.pos = [cx + sep, gy, cz];
    fighters[0].root.yaw = 0; fighters[1].root.yaw = Math.PI;
    const dt = 1 / 60, out = {}; for (const c of cams) out[c] = [];
    const times = sc.times, last = Math.max(...times);
    const acts = sc.actions.slice(); let ti = 0; const hurts = [];
    if (sc.link) { fighters[0].anim.setOpponent(fighters[1].anim); fighters[1].anim.setOpponent(fighters[0].anim); }
    renderer.setSize(480, 400); camera.aspect = 480 / 400; camera.updateProjectionMatrix();
    const target = [cx, gy + (sc.ground ? 0.35 : 0.95), cz];
    const camDef = { front: [cx - 1.3, gy + 1.15, cz + 3.0], side: [cx, gy + 1.1, cz - 3.0], top34: [cx - 1.5, gy + 2.5, cz - 2.2], overhead: [cx, gy + 3.4, cz] };   // front = 3/4 por el lado derecho de beige
    for (let i = 0; i * dt <= last + dt; i++) {
      const t = i * dt;
      if (sc.ground) for (let k = 0; k < 2; k++) fighters[k].anim.setState({ stance: k === 0 ? 'groundTop' : 'groundBottom', groundPos: sc.ground });
      while (acts.length && acts[0].t <= t + 1e-9) { const a = acts.shift(); if (a.play) fighters[a.who].anim.play(a.play, a.opts);
        if (a.block) { const ev = { type: 'block', ...a.block }; fighters[a.who].anim.strikeBlocked(ev); fighters[1 - a.who].anim.blockHit(ev); } if (a.guard !== undefined) fighters[a.who].anim.setGuardLevel(a.guard); if (a.hurt) hurts.push({ who: a.who, ...a.hurt, age: 0 }); }
      for (let k = 0; k < fighters.length; k++) {
        const f = fighters[k];
        for (const h of hurts) if (h.who === k) { f.anim.setState({ ...(sc.ground ? { stance: k === 0 ? 'groundTop' : 'groundBottom', groundPos: sc.ground } : {}), hurt: { zone: h.zone, age: h.age, power: h.power } }); h.age += dt; }
        f.anim.update(dt, f.root);
      }
      if (ti < times.length && Math.abs(t - times[ti]) < dt / 2) {
        for (const f of fighters) f.view.update(f.anim.skeleton);
        for (const c of cams) { camera.position.set(...camDef[c]); camera.lookAt(...target); camera.fov = 32; camera.updateProjectionMatrix(); renderer.render(G.scene, camera); out[c].push(renderer.domElement.toDataURL('image/png')); }
        ti++;
      }
    }
    return out;
  }, sc, cams);
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
  save(`game_${name}.png`, await mk(cams, Math.min(4, sc.times.length), 0.8, `JUEGO REAL ${name} (${FLOOR}) filas: ${cams.join(' / ')}`));
  for (const c of cams) { save(`game_${name}_${c}.png`, await mk([c], 4, 1.0, `JUEGO REAL ${name} cam ${c}`)); }
  console.log('ok', name);
}
await browser.close(); await server.close();
